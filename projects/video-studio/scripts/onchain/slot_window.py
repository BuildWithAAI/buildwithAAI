"""Every trade and transfer of one token in the blocks around a reference transaction.

Python 3 stdlib only; holds no case data.

  python3 slot_window.py --cache <private rpc cache> --refs <refs.json> \
      [--slots-before 0] [--slots-after 2] --out <private out.json>

refs.json: [{"label", "mint", "ref_signature", "ref_wallet"}, ...]

For each reference transaction, the blocks from its slot minus --slots-before to its
slot plus --slots-after are read with getBlock (accounts mode, gzip-cached by
txfetch.block_accounts). Every successful transaction in those blocks whose token
balances include the mint is kept, in exact block order (slot, index), with each
owner's token and SOL change, the signers, and whether the Pump.fun or PumpSwap
program is among the account keys. This catches wallets that keep tokens in
non-associated token accounts and token movements that do not touch the venue
(plain transfers), which a venue's signature list would miss.

A block is several MB of JSON and getBlock is limited to about 6 calls per 10 s
per IP on the public endpoint, so keep windows short (a few slots = ~1 s).
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rpc import RPC  # noqa: E402
import trades  # noqa: E402
import txfetch  # noqa: E402


def mint_rows(block, slot, mint):
    out = []
    for i, t in enumerate(block["transactions"]):
        meta = t["meta"]
        if meta.get("err") is not None:
            continue
        tbs = (meta.get("preTokenBalances") or []) + (meta.get("postTokenBalances") or [])
        if not any(tb.get("mint") == mint for tb in tbs):
            continue
        tx = txfetch.block_tx_as_tx(block, i, slot)
        tok = trades.token_deltas_by_owner(tx)
        keys = t["transaction"]["accountKeys"]
        signers = [k["pubkey"] for k in keys if k.get("signer")]
        owners = []
        for owner, mints in tok.items():
            if mint not in mints:
                continue
            d, dec = mints[mint]
            owners.append({"owner": owner, "token_delta": d / 10 ** dec,
                           "sol_delta": trades.sol_delta(tx, owner, tok) / trades.LAMPORTS,
                           "is_signer": owner in signers})
        out.append({"slot": slot, "tx_index": i, "signature": t["transaction"]["signatures"][0],
                    "blockTime": block.get("blockTime"), "venue": txfetch.venue_from_keys(tx),
                    "signers": signers, "fee_payer": signers[0] if signers else None, "owners": owners})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True)
    ap.add_argument("--refs", required=True)
    ap.add_argument("--slots-before", type=int, default=0)
    ap.add_argument("--slots-after", type=int, default=2)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    rpc = RPC(a.cache)
    refs = json.load(open(a.refs))
    done = {}
    if os.path.exists(a.out):
        done = {r["ref_signature"]: r for r in json.load(open(a.out)).get("records", [])}
    for n, ref in enumerate(refs, 1):
        if ref["ref_signature"] in done:
            continue
        rtx = txfetch.get_tx(rpc, ref["ref_signature"])
        s0 = rtx["slot"]
        rows, skipped = [], []
        for s in range(s0 - a.slots_before, s0 + a.slots_after + 1):
            try:
                blk = txfetch.block_accounts(rpc, s)
            except Exception as e:  # skipped slot or block not available
                skipped.append({"slot": s, "error": str(e)[:120]})
                continue
            if not blk:
                skipped.append({"slot": s, "error": "empty"})
                continue
            rows += mint_rows(blk, s, ref["mint"])
        ref_pos = next(((r["slot"], r["tx_index"]) for r in rows if r["signature"] == ref["ref_signature"]), None)
        done[ref["ref_signature"]] = {**ref, "ref_slot": s0, "ref_time": rtx["blockTime"], "ref_pos": ref_pos,
                                      "slots": [s0 - a.slots_before, s0 + a.slots_after], "skipped": skipped,
                                      "rows": rows}
        print(f"[{n}/{len(refs)}] {ref.get('label')}: {len(rows)} txs with the mint in "
              f"{a.slots_before + a.slots_after + 1} slots, rpc={rpc.stats}", flush=True)
        with open(a.out + ".tmp", "w") as f:
            json.dump({"params": vars(a), "records": list(done.values())}, f)
        os.replace(a.out + ".tmp", a.out)
    print("done", rpc.stats, flush=True)


if __name__ == "__main__":
    main()
