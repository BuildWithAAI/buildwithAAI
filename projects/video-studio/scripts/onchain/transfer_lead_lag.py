"""Timing and PnL around a reference buy when a group ACQUIRES, MOVES and SELLS a token.

Python 3 stdlib only; holds no case data.

  python3 transfer_lead_lag.py --in <private events.json> --sol-usd 89.6 --out <private metrics.json>

Input: {"tokens": {mint: {"wallets": {label: {"role": "public"|"side", "subrole": str,
        "events": [{slot, tx_index, blockTime, token_delta, sol_delta, usd_delta,
                    other_assets, signers, counterparties}, ...]}}}}}
(one event per transaction that changed the wallet's balance of that token; e.g. the
output of a per-wallet token-account rebuild). Exactly one "public" wallet per token.

Event classes (per wallet, per transaction):
  buy        token in, and SOL (lamports + wSOL) or a stablecoin out
  sell       token out, and SOL or a stablecoin in
  recv       token in with no SOL/stablecoin leg (a transfer from another wallet)
  send       token out with no SOL/stablecoin leg
  other_quote  token moved against some other asset (e.g. a token-quoted pool); its
             value is NOT converted, and the token is flagged pnl_incomplete

Per token (reference = the public wallet's first buy, t = 0; order by slot, tx index):
  group_first_buy_s     first buy by any side wallet, relative to t=0 (negative = before)
  group_first_buy_slots and same-slot order (index gap) when in the public buy's slot
  first_recv_s          first wallet-to-wallet receipt by a side wallet
  first_send_s          first wallet-to-wallet send by a side wallet (distribution)
  side_sell_*_s         first / last / SOL-weighted mean side sell time
  share_sell_sol_after_ref   share of the side wallets' sell proceeds received after t=0
  side_hold_s           per side wallet: last sell - first acquisition (buy or receipt)
  group_hold_s          last side sell - first side acquisition
  pnl_sol               per wallet: sum of SOL deltas + stablecoin deltas / sol_usd over all
                        its events in the token (fees, tips, rent included)
  group (sides) and public PnL, open positions (>1% of acquired tokens still held)
Aggregates: n, median, quartiles, min, max, totals; and the same split by a timing
class: "sold_into_ref" (some side sell proceeds after t=0 and side acquisition before
t=0), "exited_before_ref" (all side sells before t=0), "same_slot_after_ref" (first side
acquisition in the reference's own block, after it: copy-trading speed),
"acquired_after_ref" (later), "held_no_sell", "no_side_acquisition".

Timing alone does not show common control; recv/send links and co-signed transactions
are stronger evidence, and still not proof of who controls the wallets.
"""

import argparse
import json
import statistics

EPS_SOL = 0.003
EPS_USD = 0.01


def pct(xs, q):
    xs = sorted(xs)
    if not xs:
        return None
    k = (len(xs) - 1) * q
    f = int(k)
    c = min(f + 1, len(xs) - 1)
    return xs[f] + (xs[c] - xs[f]) * (k - f)


def dist(xs):
    xs = [x for x in xs if x is not None]
    if not xs:
        return {"n": 0}
    return {"n": len(xs), "median": statistics.median(xs), "p25": pct(xs, 0.25), "p75": pct(xs, 0.75),
            "min": min(xs), "max": max(xs), "mean": sum(xs) / len(xs), "sum": sum(xs)}


def classify(e):
    tok, sol, usd = e["token_delta"], e["sol_delta"], e.get("usd_delta", 0.0)
    other = e.get("other_assets") or {}
    if tok > 0:
        if sol < -EPS_SOL or usd < -EPS_USD:
            return "buy"
        if any(v < 0 for v in other.values()):
            return "other_quote"
        return "recv"
    if tok < 0:
        if sol > EPS_SOL or usd > EPS_USD:
            return "sell"
        if any(v > 0 for v in other.values()):
            return "other_quote"
        return "send"
    return "none"


def key(e):
    return (e["slot"], e["tx_index"] if e.get("tx_index") is not None else 10 ** 9)


def per_token(mint, rec, sol_usd):
    W = rec["wallets"]
    pub = [l for l, w in W.items() if w["role"] == "public"]
    sides = [l for l, w in W.items() if w["role"] == "side" and w["events"]]
    out = {"mint": mint, "wallets": {}}
    if not pub:
        return None
    pev = sorted(W[pub[0]]["events"], key=key)
    for e in pev:
        e["cls"] = classify(e)
    pb = next((e for e in pev if e["cls"] == "buy"), None) or next((e for e in pev if e["token_delta"] > 0), None)
    if pb is None:
        return None
    t0, s0, i0 = pb["blockTime"], pb["slot"], pb.get("tx_index")
    out.update({"ref_time": t0, "ref_slot": s0, "ref_tx_index": i0, "ref_class": pb["cls"]})
    incomplete = False
    side_ev = []
    for lab in [pub[0]] + sides:
        evs = sorted(W[lab]["events"], key=key)
        for e in evs:
            e["cls"] = classify(e)
            if e["cls"] == "other_quote":
                incomplete = True
        acq = [e for e in evs if e["cls"] in ("buy", "recv")]
        sells = [e for e in evs if e["cls"] == "sell"]
        tin = sum(e["token_delta"] for e in evs if e["token_delta"] > 0)
        tout = -sum(e["token_delta"] for e in evs if e["token_delta"] < 0)
        pnl = sum(e["sol_delta"] + e.get("usd_delta", 0.0) / sol_usd for e in evs)
        out["wallets"][lab] = {
            "role": W[lab]["role"], "subrole": W[lab].get("subrole"), "n_events": len(evs),
            "classes": {c: sum(1 for e in evs if e["cls"] == c) for c in ("buy", "sell", "recv", "send", "other_quote")},
            "pnl_sol": pnl, "buy_sol": -sum(e["sol_delta"] + e.get("usd_delta", 0.0) / sol_usd for e in evs if e["cls"] == "buy"),
            "sell_sol": sum(e["sol_delta"] + e.get("usd_delta", 0.0) / sol_usd for e in sells),
            "first_acq_s": (min(acq, key=key)["blockTime"] - t0) if acq else None,
            "last_sell_s": (max(sells, key=key)["blockTime"] - t0) if sells else None,
            "hold_s": (max(sells, key=key)["blockTime"] - min(acq, key=key)["blockTime"]) if acq and sells else None,
            "open_position": tin > 0 and (tin - tout) > 0.01 * tin,
        }
        if lab != pub[0]:
            side_ev += [dict(e, wallet=lab) for e in evs]
    out["pnl_incomplete"] = incomplete
    out["n_side_wallets_active"] = len(sides)
    out["public_pnl_sol"] = out["wallets"][pub[0]]["pnl_sol"]
    out["public_hold_s"] = out["wallets"][pub[0]]["hold_s"]
    out["side_pnl_sol"] = sum(out["wallets"][l]["pnl_sol"] for l in sides)
    out["any_side_open"] = any(out["wallets"][l]["open_position"] for l in sides)
    if not side_ev:
        out["timing_class"] = "no_side_activity"
        return out
    buys = [e for e in side_ev if e["cls"] == "buy"]
    recvs = [e for e in side_ev if e["cls"] == "recv"]
    sends = [e for e in side_ev if e["cls"] == "send"]
    sells = [e for e in side_ev if e["cls"] == "sell"]
    acq = buys + recvs
    if buys:
        fb = min(buys, key=key)
        out["group_first_buy_s"] = fb["blockTime"] - t0
        out["group_first_buy_slots"] = fb["slot"] - s0
        out["group_first_buy_same_slot"] = fb["slot"] == s0
        if fb["slot"] == s0 and fb.get("tx_index") is not None and i0 is not None:
            out["group_first_buy_index_gap"] = i0 - fb["tx_index"]
        out["group_bought_first"] = key(fb) < (s0, i0 if i0 is not None else 10 ** 9)
        out["group_buy_sol"] = -sum(e["sol_delta"] + e.get("usd_delta", 0.0) / sol_usd for e in buys)
    if recvs:
        out["first_recv_s"] = min(recvs, key=key)["blockTime"] - t0
    if sends:
        out["first_send_s"] = min(sends, key=key)["blockTime"] - t0
        out["n_sends"] = len(sends)
    if sells:
        rel = [e["blockTime"] - t0 for e in sells]
        w = [max(e["sol_delta"] + e.get("usd_delta", 0.0) / sol_usd, 0.0) for e in sells]
        out["side_sell_first_s"] = min(rel)
        out["side_sell_last_s"] = max(rel)
        out["side_sell_weighted_s"] = (sum(r * x for r, x in zip(rel, w)) / sum(w)) if sum(w) > 0 else None
        after = sum(x for e, x in zip(sells, w) if key(e) > (s0, i0 if i0 is not None else -1))
        out["side_sell_sol"] = sum(w)
        out["side_sell_sol_after_ref"] = after
        out["share_sell_sol_after_ref"] = (after / sum(w)) if sum(w) > 0 else None
        out["n_side_sells"] = len(sells)
    if acq and sells:
        out["group_hold_s"] = max(sells, key=key)["blockTime"] - min(acq, key=key)["blockTime"]
    first_acq = min(acq, key=key) if acq else None
    if first_acq is None:
        out["timing_class"] = "no_side_acquisition"
    elif key(first_acq) > (s0, i0 if i0 is not None else 10 ** 9):
        # bought in the reference's own block, right after it (copy-trading speed), or later
        out["timing_class"] = "same_slot_after_ref" if first_acq["slot"] == s0 else "acquired_after_ref"
    elif sells and out["side_sell_sol_after_ref"] > 0:
        out["timing_class"] = "sold_into_ref"
    elif sells:
        out["timing_class"] = "exited_before_ref"
    else:
        out["timing_class"] = "held_no_sell"
    return out


def aggregate(toks):
    def sub(ts):
        return {
            "n_tokens": len(ts),
            "group_first_buy_s": dist([t.get("group_first_buy_s") for t in ts]),
            "share_group_bought_first": (sum(1 for t in ts if t.get("group_bought_first")) /
                                         max(1, sum(1 for t in ts if "group_bought_first" in t))),
            "n_group_first_buy_same_slot": sum(1 for t in ts if t.get("group_first_buy_same_slot")),
            "first_recv_s": dist([t.get("first_recv_s") for t in ts]),
            "first_send_s": dist([t.get("first_send_s") for t in ts]),
            "side_sell_first_s": dist([t.get("side_sell_first_s") for t in ts]),
            "side_sell_last_s": dist([t.get("side_sell_last_s") for t in ts]),
            "side_sell_weighted_s": dist([t.get("side_sell_weighted_s") for t in ts]),
            "share_sell_sol_after_ref": dist([t.get("share_sell_sol_after_ref") for t in ts]),
            "side_sell_sol_total": sum(t.get("side_sell_sol", 0) for t in ts),
            "side_sell_sol_after_ref_total": sum(t.get("side_sell_sol_after_ref", 0) for t in ts),
            "group_hold_s": dist([t.get("group_hold_s") for t in ts]),
            "side_hold_s_per_wallet": dist([w["hold_s"] for t in ts for w in t["wallets"].values()
                                            if w["role"] == "side" and w["hold_s"] is not None]),
            "public_hold_s": dist([t.get("public_hold_s") for t in ts]),
            "side_pnl_sol": dist([t["side_pnl_sol"] for t in ts]),
            "public_pnl_sol": dist([t["public_pnl_sol"] for t in ts]),
            "side_pnl_sol_total": sum(t["side_pnl_sol"] for t in ts),
            "public_pnl_sol_total": sum(t["public_pnl_sol"] for t in ts),
            "share_side_profitable": (sum(1 for t in ts if t["side_pnl_sol"] > 0) / len(ts)) if ts else None,
            "share_public_profitable": (sum(1 for t in ts if t["public_pnl_sol"] > 0) / len(ts)) if ts else None,
            "n_pnl_incomplete": sum(1 for t in ts if t["pnl_incomplete"]),
            "n_side_open": sum(1 for t in ts if t.get("any_side_open")),
            "n_side_wallets_active": dist([t["n_side_wallets_active"] for t in ts]),
        }
    toks = [t for t in toks if t]
    classes = sorted({t["timing_class"] for t in toks})
    return {"all": sub(toks), "by_timing_class": {c: sub([t for t in toks if t["timing_class"] == c]) for c in classes},
            "timing_class_counts": {c: sum(1 for t in toks if t["timing_class"] == c) for c in classes}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--sol-usd", type=float, required=True, help="on-chain SOL/USD reference to value stablecoin legs")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    d = json.load(open(a.inp))
    toks = [per_token(m, rec, a.sol_usd) for m, rec in d["tokens"].items()]
    res = {"sol_usd": a.sol_usd, "aggregate": aggregate(toks), "tokens": [t for t in toks if t]}
    json.dump(res, open(a.out, "w"), indent=1)
    print(json.dumps(res["aggregate"]["timing_class_counts"]))


if __name__ == "__main__":
    main()
