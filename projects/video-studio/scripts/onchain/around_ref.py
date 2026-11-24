"""Who traded a token just before a reference trade, and where did their tokens go?

Python 3 stdlib only; holds no case data.

  python3 around_ref.py --cache <private rpc cache> --refs <refs.json> \
      [--lookback 120] [--max-before 40] [--follow-transfers] --out <private out.json>

refs.json: [{"label": ..., "mint": ..., "ref_signature": ..., "ref_wallet": ...}, ...]
(ref = e.g. a public wallet's first buy of the token).

For each reference trade:
  1. The venue account is read from the reference transaction itself: the owner,
     other than the reference wallet, whose balance of the mint moved the most in
     the opposite direction (the Pump.fun bonding curve or the PumpSwap pool).
  2. getSignaturesForAddress(venue, before=ref) lists the venue's transactions just
     ahead of the reference, newest first; those inside --lookback seconds are
     fetched (at most --max-before) and every wallet whose balance of the mint
     changed is recorded with its token and SOL change (signer flag included).
  3. With --follow-transfers, each wallet that bought ahead of the reference has
     its token account history for this mint listed (one call per wallet, both
     token programs) and every transaction in it is fetched: token movements
     without a SOL leg show where the tokens went (recipients) or came from.

Ordering uses (slot, transaction index); for transactions fetched one by one the
index comes from the signature listing's transactionIndex.

This is detection only. Being early, even repeatedly, does not show common
ownership: copy-trading bots, shared signal feeds and launch snipers look the
same. Token transfers between wallets are stronger links, still not proof.
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rpc import RPC  # noqa: E402
import solkeys  # noqa: E402
import trades  # noqa: E402
import txfetch  # noqa: E402


def signers_of(tx):
    return [k["pubkey"] if isinstance(k, dict) else k
            for k in tx["transaction"]["message"]["accountKeys"]
            if isinstance(k, dict) and k.get("signer")]


def venue_owner(tx, mint, ref_wallet):
    """Owner whose balance of `mint` moved most, opposite to the reference wallet."""
    tok = trades.token_deltas_by_owner(tx)
    mine = tok.get(ref_wallet, {}).get(mint, (0, 0))[0]
    best, best_abs = None, 0
    for owner, mints in tok.items():
        if owner == ref_wallet or mint not in mints:
            continue
        d = mints[mint][0]
        if mine and (d > 0) == (mine > 0):
            continue
        if abs(d) > best_abs:
            best, best_abs = owner, abs(d)
    return best


def token_account_of(tx, owner, mint):
    """Address of `owner`'s token account for `mint` in this transaction (or None).
    Newer venues keep many tokens' vaults under one shared owner, so the vault's
    own address, not its owner, is what identifies one token's venue history."""
    keys = [k["pubkey"] if isinstance(k, dict) else k for k in tx["transaction"]["message"]["accountKeys"]]
    meta = tx["meta"]
    for tb in (meta.get("postTokenBalances") or []) + (meta.get("preTokenBalances") or []):
        if tb.get("owner") == owner and tb.get("mint") == mint and tb["accountIndex"] < len(keys):
            return keys[tb["accountIndex"]]
    return None


def wallet_rows(tx, mint, exclude=()):
    """Every owner whose balance of `mint` changed: token delta (ui units), SOL delta."""
    tok = trades.token_deltas_by_owner(tx)
    sig = set(signers_of(tx))
    out = []
    for owner, mints in tok.items():
        if owner in exclude or mint not in mints:
            continue
        d, dec = mints[mint]
        out.append({"owner": owner, "token_delta": d / 10 ** dec,
                    "sol_delta": trades.sol_delta(tx, owner, tok) / trades.LAMPORTS,
                    "is_signer": owner in sig})
    return out


def ata_history(rpc, owner, mint, max_pages=3):
    rows = []
    for prog in (solkeys.TOKEN_PROGRAM, solkeys.TOKEN_2022):
        ata = solkeys.get_ata(owner, mint, prog)
        before = None
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


def around(rpc, ref, lookback, max_before, follow):
    mint, wallet = ref["mint"], ref["ref_wallet"]
    rtx = txfetch.get_tx(rpc, ref["ref_signature"])
    venue = venue_owner(rtx, mint, wallet)
    t_ref, s_ref = rtx["blockTime"], rtx["slot"]
    page = rpc.call("getSignaturesForAddress",
                    [venue, {"limit": max_before, "before": ref["ref_signature"], "commitment": "finalized"}],
                    cache_null=True) or []
    before = []
    for r in page:
        if r.get("err") or r.get("blockTime") is None or r["blockTime"] < t_ref - lookback:
            continue
        tx = txfetch.get_tx(rpc, r["signature"])
        before.append({"signature": r["signature"], "slot": r["slot"], "tx_index": r.get("transactionIndex"),
                       "blockTime": r["blockTime"], "dt_s": r["blockTime"] - t_ref, "venue": trades.venue_of(tx),
                       "signers": signers_of(tx), "wallets": wallet_rows(tx, mint, exclude=(venue,))})
    before.sort(key=lambda x: (x["slot"], x["tx_index"] if x["tx_index"] is not None else 0))
    out = {"label": ref.get("label"), "mint": mint, "venue_account": venue, "ref_time": t_ref, "ref_slot": s_ref,
           "ref_signature": ref["ref_signature"], "listed_before": len(page),
           "lookback_complete": bool(page) and (page[-1].get("blockTime") or 0) < t_ref - lookback,
           "before": before}
    if follow:
        buyers = {w["owner"] for b in before for w in b["wallets"] if w["token_delta"] > 0 and w["owner"] != wallet}
        flows = {}
        for b in sorted(buyers):
            hist = [r for r in ata_history(rpc, b, mint) if not r.get("err")]
            moves = []
            for r in sorted(hist, key=lambda r: (r["slot"], r.get("transactionIndex") or 0)):
                tx = txfetch.get_tx(rpc, r["signature"])
                rows = wallet_rows(tx, mint, exclude=(venue,))
                me = next((w for w in rows if w["owner"] == b), None)
                if not me:
                    continue
                moves.append({"signature": r["signature"], "slot": r["slot"], "tx_index": r.get("transactionIndex"),
                              "blockTime": r["blockTime"], "dt_s": r["blockTime"] - t_ref,
                              "venue": trades.venue_of(tx), "token_delta": me["token_delta"],
                              "sol_delta": me["sol_delta"], "signers": signers_of(tx),
                              "counterparties": [w for w in rows if w["owner"] != b]})
            flows[b] = {"ata_ok_sigs": len(hist), "moves": moves}
        out["buyer_flows"] = flows
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True)
    ap.add_argument("--refs", required=True)
    ap.add_argument("--lookback", type=int, default=120)
    ap.add_argument("--max-before", type=int, default=40)
    ap.add_argument("--follow-transfers", action="store_true")
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
        done[ref["ref_signature"]] = around(rpc, ref, a.lookback, a.max_before, a.follow_transfers)
        rec = done[ref["ref_signature"]]
        print(f"[{n}/{len(refs)}] {ref.get('label')}: {len(rec['before'])} txs before, "
              f"{len(rec.get('buyer_flows', {}))} buyers followed, rpc={rpc.stats}", flush=True)
        with open(a.out + ".tmp", "w") as f:
            json.dump({"params": vars(a), "records": list(done.values())}, f)
        os.replace(a.out + ".tmp", a.out)
    print("done", rpc.stats, flush=True)


if __name__ == "__main__":
    main()
