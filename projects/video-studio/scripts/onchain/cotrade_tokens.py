"""Rebuild every group wallet's trades in a list of tokens.

Python 3 stdlib only; holds no case data (addresses come from a private config).

  python3 cotrade_tokens.py --config <private config.json> --mints <mints.json> \
      --out <private cotrade.json>

Config: {"cache_dir": ..., "wallets": [{"label", "role": public|side|..., "address"}]}
mints.json: [{"mint": ..., "token_program": ...}, ...]  (token_program optional;
            both SPL Token and Token-2022 accounts are tried when it is missing)

For each token and wallet, the wallet's associated token account is derived
and its signature history listed: that history holds only the transactions that
changed the wallet's balance of that token, so no unrelated traffic is fetched.
Slots where two or more group wallets touched the token are read once with
getBlock (accounts mode), which also gives each transaction's index in the
block (exact same-slot order). Other transactions are fetched one by one with
getTransaction. All trades are parsed from meta (token delta; SOL delta
including fees, tips and rent).
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


def ata_history(rpc, ata, max_pages=5):
    rows, before = [], None
    for _ in range(max_pages):
        opts = {"limit": 1000, "commitment": "finalized"}
        if before:
            opts["before"] = before
        page = rpc.call("getSignaturesForAddress", [ata, opts], cache_null=True) or []
        rows += page
        if len(page) < 1000:
            break
        before = page[-1]["signature"]
    return rows


def rebuild_token(rpc, wallets, mint, prog=None, block_min_wallets=2):
    progs = [prog] if prog else [solkeys.TOKEN_2022, solkeys.TOKEN_PROGRAM]
    hist = {}
    for w in wallets:
        rows = []
        for p in progs:
            rows += ata_history(rpc, solkeys.get_ata(w["address"], mint, p))
        hist[w["label"]] = [r for r in rows if not r.get("err")]
    by_slot = collections.defaultdict(set)
    for lab, rows in hist.items():
        for r in rows:
            by_slot[r["slot"]].add(lab)
    block_slots = {s for s, labs in by_slot.items() if len(labs) >= block_min_wallets}
    blocks = {s: txfetch.block_accounts(rpc, s) for s in sorted(block_slots)}
    out = {}
    slot_ctx = {}
    for s, blk in blocks.items():
        idx = {t["transaction"]["signatures"][0]: i for i, t in enumerate(blk["transactions"])}
        ctx = []
        for i, t in enumerate(blk["transactions"]):
            mints = {tb["mint"] for tb in (t["meta"].get("preTokenBalances") or []) + (t["meta"].get("postTokenBalances") or [])}
            if mint in mints:
                signers = [k["pubkey"] for k in t["transaction"]["accountKeys"] if k.get("signer")]
                lab = next((w["label"] for w in wallets if w["address"] in signers), None)
                ctx.append({"tx_index": i, "ok": t["meta"]["err"] is None, "group_label": lab})
        slot_ctx[s] = {"blockTime": blk.get("blockTime"), "n_txs_in_block": len(blk["transactions"]),
                       "mint_txs": ctx, "index": idx}
    for w in wallets:
        wt = []
        for r in sorted(hist[w["label"]], key=lambda r: r["slot"]):
            s = r["slot"]
            if s in blocks:
                i = slot_ctx[s]["index"].get(r["signature"])
                tx = txfetch.block_tx_as_tx(blocks[s], i, s)
                got = trades.parse_wallet_trades(tx, w["address"], tx_index=i)
                for x in got:
                    x["venue"] = txfetch.venue_from_keys(tx)
            else:
                tx = txfetch.get_tx(rpc, r["signature"])
                got = trades.parse_wallet_trades(tx, w["address"])
            for x in got:
                if x["token"] != mint:
                    continue
                x["wallet_label"] = w["label"]
                x["wallet_role"] = w["role"]
                wt.append(x)
        out[w["label"]] = {"ata_ok_sigs": len(hist[w["label"]]), "trades": wt}
    for s in slot_ctx:
        slot_ctx[s].pop("index", None)
    return {"mint": mint, "token_program": prog, "wallets": out, "shared_slots": slot_ctx}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--mints", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    cfg = json.load(open(a.config))
    rpc = RPC(cfg["cache_dir"])
    mints = json.load(open(a.mints))
    done = {}
    if os.path.exists(a.out):
        for r in json.load(open(a.out)).get("records", []):
            done[r["mint"]] = r
    for n, m in enumerate(mints, 1):
        if m["mint"] in done:
            continue
        rec = rebuild_token(rpc, cfg["wallets"], m["mint"], m.get("token_program"))
        done[m["mint"]] = rec
        print(f"[{n}/{len(mints)}] " + " ".join(f"{k}:{len(v['trades'])}" for k, v in rec["wallets"].items())
              + f" blocks={len(rec['shared_slots'])} rpc={rpc.stats}", flush=True)
        tmp = a.out + ".tmp"
        with open(tmp, "w") as f:
            json.dump({"records": list(done.values())}, f)
        os.replace(tmp, a.out)
    print("done", rpc.stats, flush=True)


if __name__ == "__main__":
    main()
