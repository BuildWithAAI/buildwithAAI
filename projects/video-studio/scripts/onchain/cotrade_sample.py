"""Sample co-traded tokens of a wallet group and rebuild each wallet's trades.

Python 3 stdlib only; holds no case data (addresses come from a private config).

  python3 cotrade_sample.py --config <private config.json> --sigs-dir <dir> \
      --from 2026-09-22T00:00:00Z --to 2026-10-11T16:11:00Z \
      --min-side 3 --every 8 --out <private cotrade.json>

Config: {"cache_dir": ..., "wallets": [{"label", "role": public|side|..., "address"}]}
<sigs-dir>/sigs_<label>.json: getSignaturesForAddress rows for each side wallet.

Method (documented sample):
 1. Slots where at least --min-side distinct side wallets have a successful
    transaction are candidate "joint" slots. Sorted by slot, every --every-th is
    kept (systematic sample).
 2. Each sampled slot is read with getBlock (accounts mode): the list position
    of each transaction is its index in the block, so same-slot order is exact.
    The token is the mint the side wallets bought in that slot.
 3. For every configured wallet, the associated token account for that mint is
    derived and its signature history listed; successful transactions not
    already seen in the block are fetched with getTransaction and parsed
    from meta (token delta, SOL delta incl. fees).
Output: per-token records with every wallet's trades and same-slot context.
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
import solkeys  # noqa: E402
import txfetch  # noqa: E402


def iso(s):
    return int(datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp())


def parse_block_tx(block, i, slot, wallet):
    tx = txfetch.block_tx_as_tx(block, i, slot)
    rows = trades.parse_wallet_trades(tx, wallet, tx_index=i)
    v = txfetch.venue_from_keys(tx)
    for r in rows:
        r["venue"] = v
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--sigs-dir", required=True)
    ap.add_argument("--from", dest="t_from", required=True)
    ap.add_argument("--to", dest="t_to", required=True)
    ap.add_argument("--min-side", type=int, default=3)
    ap.add_argument("--every", type=int, default=8)
    ap.add_argument("--offset", type=int, default=0)
    ap.add_argument("--max-ata-pages", type=int, default=5)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    cfg = json.load(open(a.config))
    rpc = RPC(cfg["cache_dir"])
    wallets = cfg["wallets"]
    by_addr = {w["address"]: w for w in wallets}
    sides = [w for w in wallets if w["role"] == "side"]
    t0, t1 = iso(a.t_from), iso(a.t_to)

    slot_wallets = collections.defaultdict(set)
    for w in sides:
        for r in json.load(open(os.path.join(a.sigs_dir, f"sigs_{w['label']}.json"))):
            if not r.get("err") and r.get("blockTime") and t0 <= r["blockTime"] < t1:
                slot_wallets[r["slot"]].add(w["label"])
    joint = sorted(s for s, ws in slot_wallets.items() if len(ws) >= a.min_side)
    sample = joint[a.offset::a.every]
    print(f"joint slots {len(joint)}, sampled {len(sample)}", flush=True)

    records = []
    seen_mints = set()
    for n, slot in enumerate(sample, 1):
        if n > 1:
            write(a, joint, sample, records)
        blk = txfetch.block_accounts(rpc, slot)
        txs = blk["transactions"]
        in_slot = []  # (index, label, trade rows)
        for i, t in enumerate(txs):
            signers = [k["pubkey"] for k in t["transaction"]["accountKeys"] if k.get("signer")]
            for s in signers:
                if s in by_addr:
                    rows = parse_block_tx(blk, i, slot, s)
                    in_slot.append({"tx_index": i, "label": by_addr[s]["label"], "role": by_addr[s]["role"],
                                    "ok": t["meta"]["err"] is None,
                                    "signature": t["transaction"]["signatures"][0], "trades": rows})
        bought = collections.Counter(r["token"] for e in in_slot if e["role"] == "side"
                                     for r in e["trades"] if r["side"] == "buy")
        if not bought:
            records.append({"slot": slot, "blockTime": blk.get("blockTime"), "skip": "no side buy in slot",
                            "group_txs": [{k: v for k, v in e.items() if k != "trades"} for e in in_slot]})
            continue
        mint = bought.most_common(1)[0][0]
        if mint in seen_mints:
            records.append({"slot": slot, "mint": mint, "skip": "mint already sampled"})
            continue
        seen_mints.add(mint)
        prog = None
        for t in txs:
            for tb in (t["meta"].get("postTokenBalances") or []) + (t["meta"].get("preTokenBalances") or []):
                if tb["mint"] == mint:
                    prog = tb.get("programId")
                    break
            if prog:
                break
        # same-slot context: every tx in the block touching the mint
        ctx = []
        for i, t in enumerate(txs):
            mints = {tb["mint"] for tb in (t["meta"].get("preTokenBalances") or []) + (t["meta"].get("postTokenBalances") or [])}
            if mint in mints:
                signers = [k["pubkey"] for k in t["transaction"]["accountKeys"] if k.get("signer")]
                lab = next((by_addr[s]["label"] for s in signers if s in by_addr), None)
                ctx.append({"tx_index": i, "ok": t["meta"]["err"] is None, "group_label": lab})
        # every wallet's history on this mint via its associated token account
        per_wallet = {}
        block_sigs = {e["signature"]: e for e in in_slot}
        for w in wallets:
            ata = solkeys.get_ata(w["address"], mint, prog or solkeys.TOKEN_2022)
            rows, before, pages = [], None, 0
            while pages < a.max_ata_pages:
                opts = {"limit": 1000, "commitment": "finalized"}
                if before:
                    opts["before"] = before
                page = rpc.call("getSignaturesForAddress", [ata, opts], cache_null=True) or []
                pages += 1
                rows += page
                if len(page) < 1000:
                    break
                before = page[-1]["signature"]
            ok = sorted([r for r in rows if not r.get("err")], key=lambda r: r["slot"])
            wt = []
            for r in ok:
                e = block_sigs.get(r["signature"])
                if e and e["label"] == w["label"]:
                    got = [x for x in e["trades"] if x["token"] == mint]
                else:
                    tx = txfetch.get_tx(rpc, r["signature"])
                    got = [x for x in trades.parse_wallet_trades(tx, w["address"]) if x["token"] == mint]
                for x in got:
                    x["wallet_label"] = w["label"]
                    x["wallet_role"] = w["role"]
                wt += got
            per_wallet[w["label"]] = {"ata_sigs": len(rows), "ata_ok": len(ok), "trades": wt}
        records.append({"slot": slot, "blockTime": blk.get("blockTime"), "mint": mint, "token_program": prog,
                        "group_txs_in_slot": [{k: v for k, v in e.items() if k != "trades"} for e in in_slot],
                        "slot_context": ctx, "wallets": per_wallet})
        print(f"[{n}/{len(sample)}] slot {slot} trades " +
              " ".join(f"{k}:{len(v['trades'])}" for k, v in per_wallet.items()) + f" rpc={rpc.stats}", flush=True)
    write(a, joint, sample, records)
    print("done", rpc.stats, flush=True)


def write(a, joint, sample, records):
    if True:
        tmp = a.out + ".tmp"
        with open(tmp, "w") as f:
            json.dump({"meta": {"joint_slots": len(joint), "sampled_slots": len(sample), "every": a.every,
                                "offset": a.offset, "min_side": a.min_side, "from": a.t_from, "to": a.t_to},
                       "records": records}, f)
        os.replace(tmp, a.out)


if __name__ == "__main__":
    main()
