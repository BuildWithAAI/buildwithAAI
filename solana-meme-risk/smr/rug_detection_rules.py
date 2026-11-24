"""Transparent rug-risk rules. Each rule(signals, T, W) returns
   {rule, triggered, points, max_points, hard, data_available, reason, evidence}
Points are additive (score = min(100, sum)). Thresholds T come from Settings.thresholds (calibrated on the
backtest TRAIN split, data/thresholds.json); max points W from WEIGHTS (overridable in the same file).
`hard` rules force SKIP regardless of score. A rule whose data is missing never fires; it lowers confidence."""
from __future__ import annotations
from dataclasses import asdict

WEIGHTS = {"same_slot_bundle": 25, "shared_funder_cluster": 30, "serial_deployer": 25, "creator_holds": 20,
           "early_concentration": 25, "fresh_wallet_ratio": 20, "fresh_deployer": 10, "creator_sold": 15,
           "authority_not_revoked": 40}


def _r(rule, W, triggered, frac, reason, evidence=None, hard=False, available=True):
    mp = W[rule]
    pts = int(round(mp * min(1.0, frac))) if triggered else 0
    return {"rule": rule, "triggered": bool(triggered) and pts > 0, "points": pts, "max_points": mp, "hard": bool(hard and triggered),
            "data_available": available, "reason": reason, "evidence": evidence or {}}


def same_slot_bundle(s, T, W):
    x = s["same_slot"]
    n, pct = x["same_slot_buyer_count"], x["same_slot_supply_pct"]
    heavy = n >= T.same_slot_heavy or pct >= T.same_slot_supply_heavy
    return _r("same_slot_bundle", W, n >= T.same_slot_min, 1.0 if heavy else 0.4,
              f"{n} non-creator wallet(s) bought in the creation slot ({pct}% of supply); {x['within_2_slots_count']} within 2 slots",
              {"wallets": x["same_slot_wallets"][:10], "same_slot_supply_pct": pct, "within_2_slots_supply_pct": x["within_2_slots_supply_pct"]})


def shared_funder_cluster(s, T, W):
    c = s["clusters"]
    big = c["largest_cluster_supply_pct"]
    dep = c.get("deployer_cluster")
    frac = 0.83 if big >= T.cluster_supply_high else 0.5 if big >= T.cluster_supply_warn else 0.17 if c["n_clusters"] else 0
    if dep and dep["size"] >= 2:
        frac += 0.33
    if c.get("multisend_funders"):
        frac += 0.17
    hard = bool(dep and (c["deployer_cluster_supply_pct"] or 0) >= T.cluster_supply_high)
    reason = (f"{c['n_clusters']} shared-funder cluster(s); largest bought/holds {big}% of supply; {c['clustered_buyers']} early buyers clustered"
              + (f"; deployer cluster: {dep['size']} wallets / {c['deployer_cluster_supply_pct']}%" if dep else "")
              + (f"; multi-send funders: {len(c['multisend_funders'])}" if c.get("multisend_funders") else ""))
    ev = {"clusters": [{k: cl[k] for k in ("size", "includes_deployer", "pct_supply_bought_early", "pct_supply_held_now", "shared_funders",
                                           "linked_via_hub_funder", "linked_via_multisend", "min_hop")} for cl in c["clusters"][:5]]}
    return _r("shared_funder_cluster", W, frac > 0, frac, reason, ev, hard=hard)


def serial_deployer(s, T, W):
    d = s.get("serial") or {}
    f = s.get("funder_serial") or {}
    n = d.get("total_created_other")
    if n is None:
        return _r("serial_deployer", W, False, 0, "deployer history unavailable", available=False)
    cov = d.get("coverage") or {}
    bad = d.get("bad_outcome_ratio")
    measured = sum(v for k, v in (d.get("outcomes") or {}).items() if k != "unknown")
    frac = 0.6 if n >= T.serial_high else 0.32 if n >= T.serial_warn else 0
    if bad is not None and measured >= 2 and bad >= T.serial_bad_ratio:
        frac += 0.4 if n >= T.serial_warn else 0.2
    fn = f.get("total_created_other") or 0
    if fn >= T.serial_warn:
        frac += 0.2
    return _r("serial_deployer", W, frac > 0, frac,
              f"deployer launched {n} other pump.fun coins in the {d.get('lookback_hours')}h before this one (on-chain); measured outcomes of "
              f"{measured} most recent: {d.get('outcomes')} (bad ratio {bad}); deployer's primary funder launched {fn}"
              + ("" if cov.get("stream_complete", True) and cov.get("wallet_history_complete", True) else " [partial history]"),
              {"prior_created": n, "outcomes": d.get("outcomes"), "measured": (d.get("measured") or [])[:8], "funder_created": fn, "coverage": cov,
               "api_lifetime_count_info": d.get("api_lifetime_count_info")})


def creator_holds(s, T, W):
    h = s["holders"]
    pct = h.get("creator_pct_of_supply")
    if pct is None or not h.get("source"):
        return _r("creator_holds", W, False, 0, "creator balance unknown", available=False)
    init = s["same_slot"]["creator_initial_buy_pct"]
    frac = 1.0 if pct >= T.creator_high else 0.5 if pct >= T.creator_warn else 0
    return _r("creator_holds", W, frac > 0, frac, f"creator holds {pct}% of supply at as_of (initial buy {init}%)",
              {"creator_pct_of_supply": pct, "creator_initial_buy_pct": init})


def creator_sold(s, T, W):
    cf = s.get("creator_flow") or {}
    p = cf.get("sold_pct_of_bought")
    if p is None:
        return _r("creator_sold", W, False, 0, "creator made no initial buy", {"creator_flow": cf})
    frac = 1.0 if p >= 90 else 0.5 if p >= 50 else 0
    return _r("creator_sold", W, frac > 0, frac, f"creator sold {p}% of the tokens it bought before as_of", {"creator_flow": cf})


def early_concentration(s, T, W):
    h = s["holders"]
    top10 = h.get("top10_pct_of_circulating") if h.get("top10_pct_of_circulating") is not None else h.get("top10_pct_of_supply")
    early_pct = s["same_slot"]["early_buyers_supply_pct"]
    if top10 is None:
        return _r("early_concentration", W, False, 0, "holder data unavailable", available=False)
    frac = 0.8 if top10 >= T.top10_high else 0.4 if top10 >= T.top10_warn else 0
    if early_pct >= T.early_supply_high:
        frac += 0.2
    return _r("early_concentration", W, frac > 0, frac,
              f"top-10 holders own {top10}% of circulating supply (excl. curve/pool/burn/programs); first {s['same_slot']['n_early_buyers']} buyers bought {early_pct}%",
              {"top10": h.get("top10", [])[:10], "holder_count": h.get("holder_count"), "source": h.get("source")})


def fresh_wallet_ratio(s, T, W):
    f = s["fresh"]
    r = f.get("fresh_wallet_ratio")
    if r is None:
        return _r("fresh_wallet_ratio", W, False, 0, "no buyer histories available", available=False)
    frac = 1.0 if r >= T.fresh_ratio_high else 0.5 if r >= T.fresh_ratio_warn else 0
    return _r("fresh_wallet_ratio", W, frac > 0, frac,
              f"{f['fresh_wallet_count']}/{f['buyers_with_history']} traced early buyers were < {f['fresh_hours']}h old at their buy "
              f"({f['fresh_supply_pct']}% of supply)", {"fresh_wallets": [w["wallet"] for w in f["fresh_wallets"][:10]],
               # raw inputs kept so the backtest can tune a graded version of this rule offline (it fires on ~93% of launches)
               "fresh_wallet_ratio": r, "fresh_wallet_count": f.get("fresh_wallet_count"),
               "buyers_with_history": f.get("buyers_with_history"), "fresh_supply_pct": f.get("fresh_supply_pct")})


def fresh_deployer(s, T, W):
    d = s["deployer"]
    age = d.get("deployer_age_hours_at_create")
    trig = age is not None and age <= T.fresh_deployer_hours
    return _r("fresh_deployer", W, trig, 1.0,
              f"deployer wallet age at launch: {age if age is not None else 'unknown (long history)'} h; primary funder {d.get('deployer_primary_funder')}",
              {"deployer_funders": d.get("deployer_funders")}, available=age is not None or d.get("deployer_is_hub"))


def authority_not_revoked(s, T, W):
    a = s["authorities"]
    if not a.get("found"):
        return _r("authority_not_revoked", W, False, 0, "mint account not found", available=False)
    trig = not (a.get("mint_authority_revoked") and a.get("freeze_authority_revoked"))
    return _r("authority_not_revoked", W, trig, 1.0, f"mint authority={a.get('mint_authority')}, freeze authority={a.get('freeze_authority')}",
              {"mint_authority": a.get("mint_authority"), "freeze_authority": a.get("freeze_authority")}, hard=True)


RULES = [same_slot_bundle, shared_funder_cluster, serial_deployer, creator_holds, early_concentration, fresh_wallet_ratio,
         fresh_deployer, creator_sold, authority_not_revoked]


def evaluate(signals, thresholds, weights=None):
    W = {**WEIGHTS, **(weights or {})}
    out = []
    for rule in RULES:
        try:
            out.append(rule(signals, thresholds, W))
        except Exception as e:   # a broken rule must never crash scoring
            out.append({"rule": rule.__name__, "triggered": False, "points": 0, "max_points": W.get(rule.__name__, 0), "hard": False,
                        "data_available": False, "reason": f"rule error: {e!r}", "evidence": {}})
    return out
