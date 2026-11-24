"""Token movements that are not trades: a mint's signatures minus its venue's signatures.

Python 3 stdlib only; holds no case data.

  python3 transfer_scan.py --cache <private rpc cache> --refs <refs.json> \
      [--before 600] [--after 0] [--max-pages 3] --out <private out.json>

refs.json: [{"label", "mint", "ref_signature", "ref_wallet"}, ...]

Idea: every Pump.fun bonding-curve trade and every PumpSwap swap passes the mint
account, and so do TransferChecked transfers (required for Token-2022 mints) and
associated-token-account creations. So, over the same time window,
    signatures(mint) - signatures(venue account)
are the successful transactions that touched the token WITHOUT trading on its
venue: wallet-to-wallet transfers, account creations, burns, other DEXes. Only
those are fetched, which is cheap even for busy tokens. Each is parsed into the
token change of every owner (senders negative, recipients positive), the signers
and the SOL change of each owner.

The venue account is read from the reference transaction (the owner whose balance
of the mint moved most, opposite to the reference wallet). The window is
[ref time - before, ref time + after]; at most --max-pages pages of 1,000
signatures are listed per account, and the result says whether the lists reached
the start of the window ("complete").

Plain SPL `Transfer` instructions (not TransferChecked) do not pass the mint, so a
transfer between two existing accounts of a classic SPL token can be missed; a
transfer that creates the recipient's account is still caught (the creation
passes the mint). Detection only: a transfer shows a link between two wallets,
not who controls them.
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rpc import RPC  # noqa: E402
import trades  # noqa: E402
import txfetch  # noqa: E402
from around_ref import venue_owner, signers_of  # noqa: E402


def sigs_window(rpc, address, start_before, t0, max_pages, until=None):
    rows, before, pages, complete = [], start_before, 0, False
    while pages < max_pages:
        opts = {"limit": 1000, "commitment": "finalized"}
        if before:
            opts["before"] = before
        if until:
            opts["until"] = until
        page = rpc.call("getSignaturesForAddress", [address, opts], cache_null=True) or []
        pages += 1
        rows += [r for r in page if (r.get("blockTime") or 0) >= t0]
        if not page or len(page) < 1000 or (page[-1].get("blockTime") or 0) < t0:
            complete = True
            break
        before = page[-1]["signature"]
    return rows, {"pages": pages, "complete": complete}


def scan(rpc, ref, before_s, after_s, max_pages):
    mint, wallet = ref["mint"], ref["ref_wallet"]
    rtx = txfetch.get_tx(rpc, ref["ref_signature"])
    venue = venue_owner(rtx, mint, wallet)
    t_ref = rtx["blockTime"]
    t0, t1 = t_ref - before_s, t_ref + after_s
    start = txfetch.cursor_at_time(rpc, t1 + 2)[0] if after_s > 0 else ref["ref_signature"]
    m_rows, m_meta = sigs_window(rpc, mint, start, t0, max_pages)
    v_rows, v_meta = sigs_window(rpc, venue, start, t0, max_pages)
    m_ok = {r["signature"]: r for r in m_rows if not r.get("err") and (r.get("blockTime") or 0) <= t1}
    v_ok = {r["signature"] for r in v_rows if not r.get("err")}
    # the venue list must cover at least the same time span as the mint list
    v_floor = min((r["blockTime"] for r in v_rows if r.get("blockTime")), default=t_ref)
    diff = [r for s, r in m_ok.items() if s not in v_ok and (r["blockTime"] >= v_floor or v_meta["complete"])]
    moves = []
    for r in sorted(diff, key=lambda r: (r["slot"], r.get("transactionIndex") or 0)):
        tx = txfetch.get_tx(rpc, r["signature"])
        if not tx or not tx.get("meta") or tx["meta"].get("err") is not None:
            continue
        tok = trades.token_deltas_by_owner(tx)
        owners = []
        for owner, mints in tok.items():
            if mint in mints:
                d, dec = mints[mint]
                owners.append({"owner": owner, "token_delta": d / 10 ** dec,
                               "sol_delta": trades.sol_delta(tx, owner, tok) / trades.LAMPORTS})
        moves.append({"signature": r["signature"], "slot": r["slot"], "tx_index": r.get("transactionIndex"),
                      "blockTime": r["blockTime"], "dt_s": r["blockTime"] - t_ref, "venue": trades.venue_of(tx),
                      "signers": signers_of(tx), "owners": owners})
    return {**ref, "venue_account": venue, "ref_time": t_ref, "ref_slot": rtx["slot"], "window": [t0, t1],
            "mint_sigs": len(m_rows), "mint_ok_in_window": len(m_ok), "venue_sigs": len(v_rows),
            "paging": {"mint": m_meta, "venue": v_meta, "venue_floor": v_floor},
            "non_venue_txs": len(diff), "moves": moves}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True)
    ap.add_argument("--refs", required=True)
    ap.add_argument("--before", type=int, default=600)
    ap.add_argument("--after", type=int, default=0)
    ap.add_argument("--max-pages", type=int, default=3)
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
        rec = scan(rpc, ref, a.before, a.after, a.max_pages)
        done[ref["ref_signature"]] = rec
        print(f"[{n}/{len(refs)}] {ref.get('label')}: mint sigs {rec['mint_sigs']}, venue sigs {rec['venue_sigs']}, "
              f"non-venue {rec['non_venue_txs']} (complete m={rec['paging']['mint']['complete']} "
              f"v={rec['paging']['venue']['complete']}) rpc={rpc.stats}", flush=True)
        with open(a.out + ".tmp", "w") as f:
            json.dump({"params": vars(a), "records": list(done.values())}, f)
        os.replace(a.out + ".tmp", a.out)
    print("done", rpc.stats, flush=True)


if __name__ == "__main__":
    main()
