"""Timing and PnL metrics for tokens traded by a public wallet and side wallets.

Python 3 stdlib only; holds no case data.

  python3 lead_lag.py --in <private cotrade.json> --out <private metrics.json>

Input: cotrade_tokens.py output ({"records": [{"mint", "wallets": {label:
{"trades": [...]}}}]}), trades carrying wallet_role public|side.

Per token (only tokens where the public wallet bought AND at least one side
wallet bought):
  lead_s          side first buy - public first buy, in seconds (blockTime).
                  Negative = a side wallet bought first.
  same_slot       side first buy and public first buy in the same slot; then
                  side_first_in_slot says whether the side tx had the lower
                  index in the block (exact order).
  side_first      side bought strictly earlier (earlier second, earlier slot,
                  or same slot with lower index).
  side_hold_s     per side wallet: last sell - first buy; group: last side
                  sell - first side buy.
  side_sell_rel_public_buy_s: first / last / SOL-weighted mean side sell time
                  minus the public first buy.
  pnl_sol         SOL in minus SOL out across all of a wallet's transactions in
                  that token (fees, tips and rent included). Tokens moved between
                  the wallets (transfers) carry no SOL, so a side wallet's PnL can
                  include tokens it received from the public wallet; group_pnl_sol
                  (public + sides) is not affected by such moves.
  open_position   the wallet still held more than 1% of what it bought at the
                  end of the data (PnL incomplete).
Aggregates: count, median, 25th/75th percentiles, min, max, shares.
"""

import argparse
import json
import statistics


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
            "min": min(xs), "max": max(xs), "mean": sum(xs) / len(xs)}


def key(t):
    return (t["slot"], t["tx_index"] if t.get("tx_index") is not None else 10 ** 9)


def before(a, b):
    """True if trade a happened strictly before trade b."""
    if a["slot"] != b["slot"]:
        return a["slot"] < b["slot"]
    if a.get("tx_index") is None or b.get("tx_index") is None:
        return False
    return a["tx_index"] < b["tx_index"]


def wallet_summary(trs):
    buys = [t for t in trs if t["side"] == "buy"]
    sells = [t for t in trs if t["side"] == "sell"]
    tok_in = sum(t["token_amount"] for t in trs if t["side"] in ("buy", "transfer_in"))
    tok_out = sum(t["token_amount"] for t in trs if t["side"] in ("sell", "transfer_out"))
    return {
        "first_buy": min(buys, key=key) if buys else None,
        "last_sell": max(sells, key=key) if sells else None,
        "buy_sol": sum(-t["sol_delta"] for t in buys),
        "sell_sol": sum(t["sol_delta"] for t in sells),
        "pnl_sol": sum(t["sol_delta"] for t in trs),
        "n_buys": len(buys), "n_sells": len(sells),
        "transfer_in_tokens": sum(t["token_amount"] for t in trs if t["side"] == "transfer_in"),
        "transfer_out_tokens": sum(t["token_amount"] for t in trs if t["side"] == "transfer_out"),
        "open_position": tok_in > 0 and (tok_in - tok_out) > 0.01 * tok_in,
        "sells": sells,
    }


def per_token(rec):
    roles = {}
    for lab, w in rec["wallets"].items():
        for t in w["trades"]:
            roles[lab] = t.get("wallet_role")
    pub = [lab for lab, r in roles.items() if r == "public"]
    sides = [lab for lab, r in roles.items() if r == "side"]
    S = {lab: wallet_summary(rec["wallets"][lab]["trades"]) for lab in rec["wallets"]}
    out = {"mint": rec["mint"], "wallets": {}}
    for lab, s in S.items():
        fb, ls = s["first_buy"], s["last_sell"]
        out["wallets"][lab] = {
            "role": roles.get(lab), "pnl_sol": s["pnl_sol"], "buy_sol": s["buy_sol"], "sell_sol": s["sell_sol"],
            "n_buys": s["n_buys"], "n_sells": s["n_sells"], "open_position": s["open_position"],
            "transfer_in_tokens": s["transfer_in_tokens"], "transfer_out_tokens": s["transfer_out_tokens"],
            "first_buy": {k: fb[k] for k in ("blockTime", "slot", "tx_index", "sol_delta", "venue")} if fb else None,
            "last_sell": {k: ls[k] for k in ("blockTime", "slot", "tx_index", "sol_delta", "venue")} if ls else None,
            "hold_s": (ls["blockTime"] - fb["blockTime"]) if fb and ls else None,
        }
    pb = S[pub[0]]["first_buy"] if pub and S[pub[0]]["first_buy"] else None
    side_buys = [S[l]["first_buy"] for l in sides if S[l]["first_buy"]]
    out["has_public_buy"] = pb is not None
    out["n_side_wallets_buying"] = len(side_buys)
    out["side_pnl_sol"] = sum(S[l]["pnl_sol"] for l in sides)
    out["public_pnl_sol"] = sum(S[l]["pnl_sol"] for l in pub)
    out["group_pnl_sol"] = out["side_pnl_sol"] + out["public_pnl_sol"]
    out["any_open_position"] = any(S[l]["open_position"] for l in S)
    out["public_sent_tokens_and_side_received"] = (
        any(S[l]["transfer_out_tokens"] > 0 for l in pub) and any(S[l]["transfer_in_tokens"] > 0 for l in sides))
    if not side_buys:
        return out
    sfb = min(side_buys, key=key)
    side_sells = [t for l in sides for t in S[l]["sells"]]
    if side_sells:
        lss = max(side_sells, key=key)
        out["group_side_hold_s"] = lss["blockTime"] - sfb["blockTime"]
    if pb is None:
        return out
    out["lead_s"] = sfb["blockTime"] - pb["blockTime"]
    out["lead_slots"] = sfb["slot"] - pb["slot"]
    out["same_slot"] = sfb["slot"] == pb["slot"]
    out["same_second"] = sfb["blockTime"] == pb["blockTime"]
    out["side_first"] = before(sfb, pb)
    out["public_first"] = before(pb, sfb)
    if out["same_slot"] and sfb.get("tx_index") is not None and pb.get("tx_index") is not None:
        out["side_first_in_slot"] = sfb["tx_index"] < pb["tx_index"]
        out["index_gap"] = pb["tx_index"] - sfb["tx_index"]
        # how many side wallets bought in the same slot before the public wallet
        out["n_side_before_public_in_slot"] = sum(
            1 for l in sides if S[l]["first_buy"] and S[l]["first_buy"]["slot"] == pb["slot"]
            and S[l]["first_buy"].get("tx_index") is not None and S[l]["first_buy"]["tx_index"] < pb["tx_index"])
    if side_sells:
        rel = [t["blockTime"] - pb["blockTime"] for t in side_sells]
        w = [max(t["sol_delta"], 0) for t in side_sells]
        out["side_sell_rel_public_buy_s"] = {
            "first": min(rel), "last": max(rel),
            "sol_weighted_mean": (sum(r * x for r, x in zip(rel, w)) / sum(w)) if sum(w) > 0 else None}
    pls = S[pub[0]]["last_sell"]
    if pls:
        out["public_hold_s"] = pls["blockTime"] - pb["blockTime"]
    return out


def aggregate(toks):
    both = [t for t in toks if t.get("lead_s") is not None]
    side_holds = [w["hold_s"] for t in both for w in t["wallets"].values() if w["role"] == "side" and w["hold_s"] is not None]
    agg = {
        "tokens_total": len(toks),
        "tokens_public_and_side_bought": len(both),
        "lead_s": dist([t["lead_s"] for t in both]),
        "lead_slots": dist([t["lead_slots"] for t in both]),
        "share_side_first": (sum(1 for t in both if t["side_first"]) / len(both)) if both else None,
        "share_public_first": (sum(1 for t in both if t["public_first"]) / len(both)) if both else None,
        "n_same_slot": sum(1 for t in both if t["same_slot"]),
        "n_same_second": sum(1 for t in both if t["same_second"]),
        "n_same_slot_side_first": sum(1 for t in both if t.get("side_first_in_slot")),
        "index_gap_same_slot": dist([t["index_gap"] for t in both if t.get("index_gap") is not None]),
        "side_hold_s_per_wallet": dist(side_holds),
        "group_side_hold_s": dist([t.get("group_side_hold_s") for t in both]),
        "side_first_sell_rel_public_buy_s": dist([t["side_sell_rel_public_buy_s"]["first"] for t in both if "side_sell_rel_public_buy_s" in t]),
        "side_last_sell_rel_public_buy_s": dist([t["side_sell_rel_public_buy_s"]["last"] for t in both if "side_sell_rel_public_buy_s" in t]),
        "side_weighted_sell_rel_public_buy_s": dist([t["side_sell_rel_public_buy_s"]["sol_weighted_mean"] for t in both if "side_sell_rel_public_buy_s" in t]),
        "public_hold_s": dist([t.get("public_hold_s") for t in both]),
        "side_pnl_sol_total": sum(t["side_pnl_sol"] for t in both),
        "public_pnl_sol_total": sum(t["public_pnl_sol"] for t in both),
        "side_pnl_sol_per_token": dist([t["side_pnl_sol"] for t in both]),
        "public_pnl_sol_per_token": dist([t["public_pnl_sol"] for t in both]),
        "share_tokens_side_profitable": (sum(1 for t in both if t["side_pnl_sol"] > 0) / len(both)) if both else None,
        "share_tokens_public_profitable": (sum(1 for t in both if t["public_pnl_sol"] > 0) / len(both)) if both else None,
        "n_tokens_open_position": sum(1 for t in both if t["any_open_position"]),
        "side_pnl_sol_total_closed_only": sum(t["side_pnl_sol"] for t in both if not t["any_open_position"]),
        "public_pnl_sol_total_closed_only": sum(t["public_pnl_sol"] for t in both if not t["any_open_position"]),
        "group_pnl_sol_total": sum(t["group_pnl_sol"] for t in both),
        "group_pnl_sol_per_token": dist([t["group_pnl_sol"] for t in both]),
        "n_tokens_public_sent_tokens_and_side_received": sum(1 for t in both if t["public_sent_tokens_and_side_received"]),
        "n_tokens_public_transferred_tokens_out": sum(
            1 for t in both for w in t["wallets"].values() if w["role"] == "public" and w["transfer_out_tokens"] > 0),
    }
    return agg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    recs = json.load(open(a.inp))["records"]
    toks = [per_token(r) for r in recs]
    res = {"aggregate": aggregate(toks), "tokens": toks}
    json.dump(res, open(a.out, "w"), indent=1)
    print(json.dumps(res["aggregate"], indent=1))


if __name__ == "__main__":
    main()
