"""Bad-rate evidence for the vet gate thresholds on the labeled launch dataset (data/backtest/work/backtest.db).
Signals were scored at create + 5 min (as-of, no lookahead); label = bad_24h (label_version bad24:v1).
Read-only. python tools/vet_threshold_evidence.py -o data/vet/threshold_evidence.json"""
from __future__ import annotations
import argparse, json, os, sqlite3, sys, math

DB = "data/backtest/work/backtest.db"


def g(d, *ks):
    for k in ks:
        if not isinstance(d, dict):
            return None
        d = d.get(k)
    return d


RULES = {
    "same_slot_buyers>=3": lambda e: None if g(e, "same_slot", "same_slot_buyer_count") is None else g(e, "same_slot", "same_slot_buyer_count") >= 3,
    "same_slot_supply_pct>=5": lambda e: None if g(e, "same_slot", "same_slot_supply_pct") is None else g(e, "same_slot", "same_slot_supply_pct") >= 5,
    "sniper(<=2 slots)_supply_bought_pct>=20": lambda e: None if g(e, "same_slot", "within_2_slots_supply_pct") is None else g(e, "same_slot", "within_2_slots_supply_pct") >= 20,
    "largest_cluster_supply_pct>=20": lambda e: None if g(e, "clusters", "largest_cluster_supply_pct") is None else g(e, "clusters", "largest_cluster_supply_pct") >= 20,
    "deployer_cluster_supply_pct>=10": lambda e: None if not g(e, "clusters") else (g(e, "clusters", "deployer_cluster_supply_pct") or 0) >= 10,
    "serial_prior_launches>=10": lambda e: None if g(e, "serial_deployer", "total_created_other") is None else g(e, "serial_deployer", "total_created_other") >= 10,
    "serial_bad_ratio>=0.8(measured>=3)": lambda e: None if g(e, "serial_deployer", "total_created_other") is None else bool(
        (g(e, "serial_deployer", "bad_outcome_ratio") or 0) >= 0.8 and sum(v for k, v in (g(e, "serial_deployer", "outcomes") or {}).items() if k not in ("unknown", "too_young")) >= 3),
    "top10_pct>30": lambda e: None if g(e, "holders", "top10_pct_of_supply") is None else g(e, "holders", "top10_pct_of_supply") > 30,
    "top1_pct>10": lambda e: None if g(e, "holders", "top1_pct_of_supply") is None else g(e, "holders", "top1_pct_of_supply") > 10,
    "creator_pct>10": lambda e: None if g(e, "holders", "creator_pct_of_supply") is None else g(e, "holders", "creator_pct_of_supply") > 10,
    "fresh_wallet_ratio>=0.5": lambda e: None if g(e, "fresh_wallets", "fresh_wallet_ratio") is None else g(e, "fresh_wallets", "fresh_wallet_ratio") >= 0.5,
    "mint_or_freeze_authority_active": lambda e: None if not g(e, "authorities", "found") else not (g(e, "authorities", "mint_authority_revoked") and g(e, "authorities", "freeze_authority_revoked")),
}


def wilson(k, n, z=1.96):
    if not n:
        return None
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(c - h, 3), round(c + h, 3)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--out", default="data/vet/threshold_evidence.json")
    a = ap.parse_args()
    db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    rows = []
    for doc, lab in db.execute("SELECT s.doc, l.doc FROM scored s JOIN labels l ON l.mint = s.mint WHERE s.error IS NULL AND s.doc IS NOT NULL"):
        try:
            d, l = json.loads(doc), json.loads(lab)
        except Exception:
            continue
        if not l.get("usable") or l.get("bad_24h") is None:
            continue
        rows.append((d.get("evidence") or {}, int(l["bad_24h"])))
    n, bad = len(rows), sum(b for _, b in rows)
    out = {"dataset": DB, "label": "bad_24h (bad24:v1)", "signals_as_of": "create + 300 s", "n_usable": n, "n_bad": bad,
           "base_bad_rate": round(bad / n, 4) if n else None, "rules": {}}
    for name, f in RULES.items():
        fl = [(f(e), b) for e, b in rows]
        known = [(x, b) for x, b in fl if x is not None]
        flag = [b for x, b in known if x]
        ok = [b for x, b in known if not x]
        out["rules"][name] = {"n_with_data": len(known), "flagged": len(flag), "flagged_share": round(len(flag) / len(known), 3) if known else None,
                              "bad_rate_flagged": round(sum(flag) / len(flag), 3) if flag else None, "ci95_flagged": wilson(sum(flag), len(flag)),
                              "bad_rate_passed": round(sum(ok) / len(ok), 3) if ok else None, "ci95_passed": wilson(sum(ok), len(ok)),
                              "bad_caught": sum(flag), "bad_total_with_data": sum(b for _, b in known)}
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    json.dump(out, open(a.out, "w"), indent=1)
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
