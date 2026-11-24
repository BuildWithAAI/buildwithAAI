"""Who acquired a token in a time window (e.g. its launch), and what share of supply each got.

Python 3 stdlib only; holds no case data.

  python3 launch_window.py --cache <private rpc cache> --mint <mint> \
      --venue-account <pool / bonding-curve account> --t-start <unix> --t-end <unix> \
      [--supply <token units>] [--dense-min 3] [--max-txs 3000] --out <private out.json>

Lists every transaction of the venue account (a launchpad pool, bonding curve or AMM
pool: any account every trade of the token passes) with t-start <= blockTime < t-end,
oldest first. Slots holding --dense-min or more of them are read once with getBlock
(accounts mode, exact in-block order); the rest with getTransaction (index from the
signature listing's transactionIndex). For each successful transaction it records, in
chain order (slot, index):

  * signers and fee payer;
  * every owner whose balance of the mint changed: token change, SOL change (lamports +
    wSOL), stablecoin change, and changes in any other mint (e.g. the pool's quote token);
  * the venue owner (the owner whose balance of the mint moved most) is flagged.

Per wallet it then gives: first acquisition (slot, index, time, seconds after t-start),
tokens acquired and sold in the window, net position at the end of the window, and that
position as a share of --supply (if given). A wallet that received tokens without
trading (a transfer) is listed too: `acquired_via` says how.

Detection only. Many wallets buying in the same slot at the same size is the pattern
investigators call a bundle; it does not show who controls the wallets. Launch snipers
and copy-trading bots produce similar pictures.
"""

import argparse
import collections
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rpc import RPC  # noqa: E402
import trades  # noqa: E402
import txfetch  # noqa: E402


def owner_flows(tx, mint):
    """[{owner, token_delta, sol_delta, usd_delta, other}] for owners whose balance of mint changed."""
    tok = trades.token_deltas_by_owner(tx)
    out = []
    for owner, mints in tok.items():
        if mint not in mints:
            continue
        d, dec = mints[mint]
        other = {m: v / 10 ** vd for m, (v, vd) in mints.items()
                 if m != mint and m not in trades.STABLE_MINTS and m != trades.WSOL_MINT}
        usd, _ = trades.stable_delta(tok, owner)
        out.append({"owner": owner, "token_delta": d / 10 ** dec,
                    "sol_delta": trades.sol_delta(tx, owner, tok) / trades.LAMPORTS,
                    "usd_delta": usd, "other": other})
    return out


def signers_of(tx):
    return [k["pubkey"] if isinstance(k, dict) else k
            for k in tx["transaction"]["message"]["accountKeys"]
            if isinstance(k, dict) and k.get("signer")]


def collect(rpc, mint, venue, t0, t1, dense_min=3, max_txs=3000, log=print):
    cur = txfetch.cursor_at_time(rpc, t1 + 5)
    rows, meta = rpc.signatures_in_window(venue, t0, t1, start_before=cur[0])
    ok = sorted((r for r in rows if not r.get("err")), key=lambda r: (r["slot"], r.get("transactionIndex") or 0))
    truncated = len(ok) > max_txs
    ok = ok[:max_txs]
    per_slot = collections.Counter(r["slot"] for r in ok)
    dense = {s for s, c in per_slot.items() if c >= dense_min}
    blocks, out = {}, []
    for n, r in enumerate(ok, 1):
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
            venue_tag = txfetch.venue_from_keys(tx)
        else:
            tx = txfetch.get_tx(rpc, r["signature"])
            i = r.get("transactionIndex")
            venue_tag = trades.venue_of(tx)
        if not tx or not tx.get("meta") or tx["meta"].get("err") is not None:
            continue
        flows = owner_flows(tx, mint)
        if not flows:
            continue
        vo = max(flows, key=lambda f: abs(f["token_delta"]))["owner"]
        sg = signers_of(tx)
        out.append({"signature": r["signature"], "slot": s, "tx_index": i, "blockTime": tx.get("blockTime"),
                    "signers": sg, "fee_payer": sg[0] if sg else None, "venue_tag": venue_tag,
                    "venue_owner": vo, "owners": flows})
        if log and n % 100 == 0:
            log(f"  {n}/{len(ok)} txs read, rpc={rpc.stats}")
    out.sort(key=lambda x: (x["slot"], x["tx_index"] if x["tx_index"] is not None else 10 ** 9))
    return out, {"sigs": len(rows), "ok": len(ok), "truncated": truncated, "dense_slots": len(dense),
                 "paging": meta}


def fix_venue_owner(txs, venue_owner=None):
    """Set each tx's venue_owner to the venue's real owner.

    The per-transaction guess (the owner whose balance of the mint moved most) fails on
    sells of tokens with a transfer fee: the seller's balance drops by more than the pool's
    rises. So take the owner named most often across the window (or the one given), and use
    it wherever it appears in a transaction."""
    import collections as _c
    vo = venue_owner or (_c.Counter(t["venue_owner"] for t in txs).most_common(1)[0][0] if txs else None)
    for t in txs:
        if any(f["owner"] == vo for f in t["owners"]):
            t["venue_owner"] = vo
    return vo


def per_wallet(txs, t0, supply=None, venue_owner=None):
    W = {}
    vo = fix_venue_owner(txs, venue_owner)
    venue_owners = {vo} if vo else set()
    for t in txs:
        for f in t["owners"]:
            o = f["owner"]
            if o in venue_owners:
                continue
            w = W.setdefault(o, {"owner": o, "first_in": None, "first_out": None, "acquired": 0.0, "sold": 0.0, "net": 0.0,
                                 "n_txs": 0, "signed_any": False, "acquired_via": set(),
                                 "sol_spent": 0.0, "sol_received": 0.0, "usd_delta": 0.0, "other": {}})
            w["n_txs"] += 1
            w["net"] += f["token_delta"]
            w["signed_any"] = w["signed_any"] or o in t["signers"]
            w["usd_delta"] += f["usd_delta"]
            for m, v in f["other"].items():
                w["other"][m] = w["other"].get(m, 0.0) + v
            if f["sol_delta"] < 0:
                w["sol_spent"] += -f["sol_delta"]
            else:
                w["sol_received"] += f["sol_delta"]
            if f["token_delta"] > 0:
                w["acquired"] += f["token_delta"]
                traded = t["venue_owner"] != o and any(g["owner"] == t["venue_owner"] for g in t["owners"])
                w["acquired_via"].add("venue" if traded else "transfer")
                # paid with what? (a wallet whose quote came from another account shows no outflow)
                paid = (f["sol_delta"] < -0.01 or f["usd_delta"] < -0.01 or any(v < 0 for v in f["other"].values()))
                if traded and not paid:
                    w["acquired_via"].add("venue_unpaid_by_self")
                if w["first_in"] is None:
                    w["first_in"] = {"slot": t["slot"], "tx_index": t["tx_index"], "blockTime": t["blockTime"],
                                     "dt_s": t["blockTime"] - t0, "signature": t["signature"],
                                     "fee_payer": t["fee_payer"], "n_signers": len(t["signers"])}
            else:
                w["sold"] += -f["token_delta"]
                if w["first_out"] is None:
                    w["first_out"] = {"slot": t["slot"], "tx_index": t["tx_index"], "blockTime": t["blockTime"],
                                      "dt_s": t["blockTime"] - t0, "signature": t["signature"]}
    out = []
    for w in W.values():
        w["acquired_via"] = sorted(w["acquired_via"])
        if supply:
            w["net_share_of_supply"] = w["net"] / supply
            w["acquired_share_of_supply"] = w["acquired"] / supply
        out.append(w)
    out.sort(key=lambda w: ((w["first_in"] or {}).get("slot", 1 << 62), (w["first_in"] or {}).get("tx_index") or 0))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True)
    ap.add_argument("--mint", required=True)
    ap.add_argument("--venue-account", required=True)
    ap.add_argument("--t-start", type=int, required=True)
    ap.add_argument("--t-end", type=int, required=True)
    ap.add_argument("--supply", type=float, default=None, help="total supply in token units (for shares)")
    ap.add_argument("--dense-min", type=int, default=3)
    ap.add_argument("--max-txs", type=int, default=3000)
    ap.add_argument("--venue-owner", default=None,
                    help="owner of the venue's token vault (default: the owner most often moving most)")
    ap.add_argument("--recompute", action="store_true",
                    help="re-derive the per-wallet table from an existing --out file (no RPC)")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    if a.recompute:
        d = json.load(open(a.out))
        d["wallets"] = per_wallet(d["txs"], d["meta"]["t_start"], d["meta"]["supply"], a.venue_owner)
        d["meta"]["venue_owner"] = d["txs"][0]["venue_owner"] if d["txs"] else None
        d["meta"]["n_wallets"] = len(d["wallets"])
        with open(a.out + ".tmp", "w") as f:
            json.dump(d, f)
        os.replace(a.out + ".tmp", a.out)
        print(json.dumps({"recomputed": a.out, "n_wallets": len(d["wallets"]), "venue_owner": d["meta"]["venue_owner"]}))
        return
    rpc = RPC(a.cache)
    txs, meta = collect(rpc, a.mint, a.venue_account, a.t_start, a.t_end, a.dense_min, a.max_txs)
    wallets = per_wallet(txs, a.t_start, a.supply, a.venue_owner)
    meta["venue_owner"] = txs[0]["venue_owner"] if txs else None
    meta.update({"mint": a.mint, "venue_account": a.venue_account, "t_start": a.t_start, "t_end": a.t_end,
                 "supply": a.supply, "n_txs": len(txs), "n_wallets": len(wallets), "rpc": rpc.stats})
    with open(a.out + ".tmp", "w") as f:
        json.dump({"meta": meta, "txs": txs, "wallets": wallets}, f)
    os.replace(a.out + ".tmp", a.out)
    print(json.dumps({k: v for k, v in meta.items() if k not in ("mint", "venue_account")}))


if __name__ == "__main__":
    main()
