"""Stage 5 - token risk score (0-100) and SKIP / REDUCED / NORMAL for small (1-3% of bankroll) positions.
Read-only: never trades, never signs, never touches keys."""
from __future__ import annotations
from . import rug_detection_rules as R

SIZE = {"SKIP": (0.0, 0.0, "0% - do not enter"), "REDUCED": (0.0, 1.0, "<=1% of bankroll"), "NORMAL": (1.0, 3.0, "1-3% of bankroll")}


def confidence(sig, rules):
    cov = sig["coverage"]; f = {}
    f["early_history_complete"] = 1.0 if cov["early_history_complete"] else 0.3
    f["holdings_available"] = 1.0 if cov["holdings_source"] else 0.6
    n = max(1, cov["wallets_traced"])
    f["wallet_history_coverage"] = round(0.5 + 0.5 * (cov["wallet_histories_complete"] + cov["labeled_wallets"]) / n, 3)
    unavailable = [r["rule"] for r in rules if not r["data_available"] and r["rule"] != "authority_not_revoked"]
    f["rules_with_data"] = round(1 - 0.08 * len(unavailable), 3)
    f["source_warnings"] = round(max(0.6, 1 - 0.02 * len(cov["warnings"])), 3)
    score = 1.0
    for v in f.values():
        score *= v
    score = round(score, 3)
    label = "high" if score >= 0.7 else "medium" if score >= 0.45 else "low"
    return {"score": score, "label": label, "factors": f, "rules_without_data": unavailable}


def market_gates(sig, T):
    liq = sig["liquidity"].get("best_liquidity_usd")
    holders = sig["holders"].get("holder_count")
    notes, skip, reduce = [], False, False
    if liq is not None and liq < T.min_liq_usd_any:
        skip = True; notes.append(f"liquidity ${liq:,.0f} < ${T.min_liq_usd_any:,.0f}")
    elif liq is not None and liq < T.min_liq_usd_normal:
        reduce = True; notes.append(f"liquidity ${liq:,.0f} < ${T.min_liq_usd_normal:,.0f}")
    elif liq is None:
        notes.append("liquidity unknown")
    if holders is not None and holders < T.min_holders_normal:
        reduce = True; notes.append(f"only {holders} holders")
    return {"skip": skip, "reduce": reduce, "notes": notes, "best_liquidity_usd": liq, "holder_count": holders,
            "max_order_usd_for_~1pct_impact": round(liq * 0.01, 2) if liq else None}


def decide(score, hard, conf, gates, T, apply_gates):
    reasons = []
    if hard:
        rec = "SKIP"; reasons.append(f"hard flag(s): {', '.join(hard)}")
    elif score >= T.skip_score:
        rec = "SKIP"; reasons.append(f"score {score} >= skip threshold {T.skip_score}")
    elif apply_gates and gates["skip"]:
        rec = "SKIP"; reasons.append("market gate: " + "; ".join(gates["notes"]))
    elif score >= T.reduced_score:
        rec = "REDUCED"; reasons.append(f"score {score} >= reduced threshold {T.reduced_score}")
    elif apply_gates and gates["reduce"]:
        rec = "REDUCED"; reasons.append("market gate: " + "; ".join(gates["notes"]))
    elif conf["label"] == "low":
        rec = "REDUCED"; reasons.append(f"low data coverage (confidence {conf['score']})")
    else:
        rec = "NORMAL"
    return rec, reasons


def score_signals(sig, settings, apply_market_gates=None):
    T = settings.thresholds
    rules = R.evaluate(sig, T, settings.weights)
    raw = sum(r["points"] for r in rules)
    score = min(100, raw)
    hard = [r["rule"] for r in rules if r["hard"]]
    conf = confidence(sig, rules)
    apply = (sig["mode"] == "live" and sig.get("token_age_s", 0) > 3600) if apply_market_gates is None else apply_market_gates
    gates = market_gates(sig, T)
    rec, why = decide(score, hard, conf, gates, T, apply)
    lo, hi, label = SIZE[rec]
    return {"score": score, "raw_points": raw, "recommendation": rec, "decision_reasons": why,
            "suggested_size": {"pct_of_bankroll_min": lo, "pct_of_bankroll_max": hi, "label": label},
            "hard_flags": hard, "confidence": conf, "rules": rules, "market_gates": {**gates, "applied": apply}}
