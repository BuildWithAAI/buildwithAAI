"""v0-compatible score output (the AAI Terminal adapter contract).

`python -m risk score` keeps every v0 top-level key with its v0 type:
  mint, token, score, recommendation, suggested_size (str), confidence (str), hard_flags, flags, reasons,
  small_size, rules, clusters, deployer, serial_deployer, deployer_funder_serial, authorities, holders,
  same_slot, fresh_wallets, creation, early_buyers, data_warnings, coverage, timings, generated_at, disclaimer
and only ADDS fields (see ADDED_KEYS). The full schema-validated risk_report.v1 document is embedded under
`risk_report_v1`; `--format v1` prints it alone."""
from __future__ import annotations
import time

V0_KEYS = ["mint", "token", "score", "recommendation", "suggested_size", "confidence", "hard_flags", "flags", "reasons", "small_size",
           "rules", "clusters", "deployer", "serial_deployer", "deployer_funder_serial", "authorities", "holders", "same_slot",
           "fresh_wallets", "creation", "early_buyers", "data_warnings", "coverage", "timings", "generated_at", "disclaimer"]
ADDED_KEYS = ["schema_compat", "as_of", "mode", "raw_points", "decision_reasons", "suggested_size_detail", "confidence_detail",
              "market_gates", "model_version", "orchestrator_summary", "risk_report_v1"]
SIZE_STR = {"SKIP": "0%", "REDUCED": "<=1% of bankroll", "NORMAL": "1-3% of bankroll"}
BUYER_KEYS = ("rank", "wallet", "slot", "slot_offset", "block_time", "sol_amount", "quote_amount", "signer_sol_spent",
              "pct_supply_bought", "is_creator", "same_slot_as_create", "signature")


def _small_size(sig, sc):
    liq = sig["liquidity"].get("best_liquidity_usd")
    g = sc.get("market_gates") or {}
    return {"small_size_trade_reasonable": bool(liq is not None and liq >= 2000), "best_liquidity_usd": liq,
            "holder_count": sig["holders"].get("holder_count"), "market_cap_usd": sig["liquidity"].get("market_cap_usd"),
            "max_order_usd_for_~1pct_impact": round(liq * 0.01, 2) if liq else None, "notes": g.get("notes", [])}


def build(sig, sc, doc, full=False):
    e = sig["early"]
    buyers = []
    for b in e["buyers"]:
        x = {k: b.get(k) for k in BUYER_KEYS}
        t = sig["traces"].get(b["wallet"]) or {}
        x["funders"] = [{"funder": f["funder"], "sol": round((f.get("lamports") or 0) / 1e9, 4), "label": f.get("label"),
                         "hop2": [g["funder"] for g in f.get("hop2", []) or []]} for f in t.get("funders", [])]
        x["wallet_sig_count"] = (t.get("info") or {}).get("sigs_scanned")
        x["pct_supply_held_as_of"] = b.get("pct_supply_held_as_of")   # added
        buyers.append(x)
    holders = {k: v for k, v in sig["holders"].items() if k != "balances"}
    cov = dict(sig["coverage"])
    rpc = (doc.get("data_coverage") or {}).get("sources", {}).get("rpc", {})
    cov.update({"hub_wallets_not_expanded": cov.get("hub_wallets"), "trace_warnings": cov.get("warnings", []),
                "rpc_provider": "helius" if any(n == "helius" for n in rpc.get("endpoints", {})) else "public-rpc",
                "rpc_stats": {"calls": rpc.get("network_calls"), "cache_hits": rpc.get("cache_hits"),
                              "429s": sum(v.get("rate_limited", 0) for v in rpc.get("endpoints", {}).values()),
                              "errors": sum(v.get("errors", 0) for v in rpc.get("endpoints", {}).values())}})
    out = {
        "mint": sig["mint"], "token": sig["coin"], "score": sc["score"], "recommendation": sc["recommendation"],
        "suggested_size": SIZE_STR[sc["recommendation"]], "confidence": sc["confidence"]["label"], "hard_flags": sc["hard_flags"],
        "flags": [r["rule"] for r in sc["rules"] if r["triggered"]],
        "reasons": ([f"HARD FLAG(S): {', '.join(sc['hard_flags'])} -> SKIP"] if sc["hard_flags"] else [])
                   + [f"[+{r['points']}] {r['rule']}: {r['reason']}" for r in sc["rules"] if r["triggered"]],
        "small_size": _small_size(sig, sc), "rules": sc["rules"], "clusters": sig["clusters"], "deployer": sig["deployer"],
        "serial_deployer": sig["serial"], "deployer_funder_serial": sig["funder_serial"], "authorities": sig["authorities"],
        "holders": holders, "same_slot": sig["same_slot"], "fresh_wallets": sig["fresh"], "creation": e.get("creation"),
        "early_buyers": buyers, "data_warnings": cov.get("warnings", []), "coverage": cov, "timings": sig["timings"],
        "generated_at": int(time.time()),
        "disclaimer": "Heuristic risk screen only. No trading performed.",
        # ---- additions (v1) ----
        "schema_compat": {"legacy": "v0", "embedded": doc["schema_version"]},
        "as_of": sig["as_of"], "mode": sig["mode"], "raw_points": sc["raw_points"], "decision_reasons": sc["decision_reasons"],
        "suggested_size_detail": sc["suggested_size"], "confidence_detail": sc["confidence"], "market_gates": sc["market_gates"],
        "model_version": doc["orchestrator_summary"]["model"], "orchestrator_summary": doc["orchestrator_summary"],
        "risk_report_v1": doc,
    }
    if full:
        out["raw_traces"] = sig["traces"]
    return out
