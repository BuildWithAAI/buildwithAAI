"""Pure check evaluators: facts dict -> CheckResult. No I/O here (unit-testable with fixtures).
A fact that is missing, errored or stale makes its check UNKNOWN (fail-closed); FAIL needs a measured value."""
from __future__ import annotations
from .schema import CheckResult, SEV_FAIL, SEV_UNKNOWN, SEV_WARN, SEV_INFO
from .. import config as C

TOKEN_PROGRAMS = {C.TOKEN_PROGRAM, C.TOKEN_2022_PROGRAM}


def _fact(F, key, now, max_age, cr, code_prefix):
    """Fetch a fact; adds UNKNOWN reasons for missing/error/stale. Returns the fact dict or None."""
    f = F.get(key)
    if not f:
        cr.add(f"{code_prefix}_MISSING", SEV_UNKNOWN, message=f"{key} not fetched (timeout or not reached)")
        return None
    if f.get("error"):
        cr.add(f"{code_prefix}_SOURCE_ERROR", SEV_UNKNOWN, observed=str(f["error"])[:160], message=f"{key} source error")
        return None
    ts = f.get("as_of")
    if ts is None or (max_age is not None and now - ts > max_age):
        cr.add(f"{code_prefix}_STALE", SEV_UNKNOWN, observed=None if ts is None else round(now - ts, 1), threshold=max_age,
               message=f"{key} older than allowed")
        return None
    cr.sources += f.get("sources", [])
    cr.data_as_of = ts if cr.data_as_of is None else min(cr.data_as_of, ts)
    if f.get("slot"):
        cr.slot = f["slot"]
    cr.latency_ms = max(cr.latency_ms or 0, f.get("latency_ms") or 0)
    return f


def check_input(F, T, now, cfg):
    cr = CheckResult("input", latency_ms=0, data_as_of=now)
    i = F.get("input") or {}
    if not i.get("ok"):
        cr.add(i.get("code") or "MINT_INVALID", SEV_FAIL, message="mint failed validation")
        return cr
    cr.metrics = {"pump_suffix": i.get("pump_suffix")}
    if not i.get("pump_suffix"):
        cr.add("MINT_SUFFIX_NOT_PUMP", SEV_INFO, observed=False, message="no 'pump' suffix; pump.fun origin proven on-chain instead")
    return cr.finish()


def check_authority(F, T, now, cfg):
    cr = CheckResult("authority")
    cv = _fact(F, "curve", now, cfg.max_fast_age_s, cr, "CURVE")
    mt = _fact(F, "mint", now, cfg.max_fast_age_s, cr, "MINT")
    if cv is not None:
        if not cv.get("found") or cv.get("owner") != C.PUMP_PROGRAM or cv.get("decode_error"):
            cr.add("NOT_PUMP_FUN", SEV_FAIL, observed=cv.get("owner"), threshold=C.PUMP_PROGRAM, message="no pump.fun bonding-curve account for this mint")
        else:
            cr.metrics.update({"venue": "pumpswap" if cv.get("complete") else "pump_curve", "complete": cv.get("complete"),
                               "quote_mint": cv.get("quote_mint"), "curve_layout_len": cv.get("layout_len")})
            if cv.get("quote_mint") != "SOL":
                cr.add("QUOTE_NOT_SOL", SEV_FAIL, observed=cv.get("quote_mint"), threshold="SOL", message="executor trades SOL-quoted curves only")
            if cv.get("complete"):
                pl = _fact(F, "pool", now, cfg.max_fast_age_s, cr, "POOL")
                if pl is not None:
                    if not pl.get("found") or pl.get("owner") != C.PUMP_AMM_PROGRAM or pl.get("decode_error"):
                        cr.add("MIGRATED_POOL_NOT_FOUND", SEV_FAIL, message="curve complete but canonical PumpSwap pool missing")
                    elif pl.get("base_mint") != F.get("mint_address") or pl.get("quote_mint") != C.WSOL_MINT:
                        cr.add("POOL_MISMATCH", SEV_FAIL, message="canonical pool does not pair this mint with WSOL")
                    else:
                        lps, lpf = pl.get("lp_mint_supply"), pl.get("lp_supply_field")
                        cr.metrics.update({"pool": pl.get("pool_address"), "lp_mint_supply": lps, "lp_supply_field": lpf})
                        if lps is None:
                            cr.add("LP_STATUS_UNKNOWN", SEV_UNKNOWN, message="LP mint supply unreadable")
                        elif lps == 0:
                            cr.metrics["lp_status"] = "burned"
                        else:
                            cr.metrics["lp_status"] = "outstanding"
                            cr.add("LP_NOT_BURNED", SEV_FAIL, observed=lps, threshold=0, message="LP tokens exist (removable liquidity)")
            else:
                cr.metrics["lp_status"] = "n/a_bonding_curve"   # liquidity is held by the pump program, not an LP
    if mt is not None:
        if not mt.get("found"):
            cr.add("MINT_ACCOUNT_NOT_FOUND", SEV_FAIL)
        else:
            cr.metrics.update({"token_program": "token2022" if mt.get("token_program") == C.TOKEN_2022_PROGRAM else "spl_token"
                               if mt.get("token_program") == C.TOKEN_PROGRAM else mt.get("token_program"),
                               "mint_authority_revoked": mt.get("mint_authority") in (None, ""),
                               "freeze_authority_revoked": mt.get("freeze_authority") in (None, ""), "extensions": mt.get("extensions")})
            if mt.get("token_program") not in TOKEN_PROGRAMS:
                cr.add("TOKEN_PROGRAM_UNEXPECTED", SEV_FAIL, observed=mt.get("token_program"))
            if mt.get("mint_authority") not in (None, ""):
                cr.add("MINT_AUTHORITY_ACTIVE", SEV_FAIL, observed=mt.get("mint_authority"), threshold=None)
            if mt.get("freeze_authority") not in (None, ""):
                cr.add("FREEZE_AUTHORITY_ACTIVE", SEV_FAIL, observed=mt.get("freeze_authority"), threshold=None)
            from .onchain import ALLOWED_T22_EXTENSIONS
            bad = [e for e in (mt.get("extensions") or []) if e not in ALLOWED_T22_EXTENSIONS]
            if bad:
                cr.add("TOKEN2022_EXTENSION_NOT_ALLOWED", SEV_FAIL, observed=bad, threshold=sorted(ALLOWED_T22_EXTENSIONS))
    return cr.finish()


def check_mayhem(F, T, now, cfg):
    cr = CheckResult("mayhem")
    cv = _fact(F, "curve", now, cfg.max_fast_age_s, cr, "CURVE")
    if cv is None:
        return cr.finish()
    flags = [cv.get("is_mayhem_mode") if cv.get("found") else None]
    pl = F.get("pool") if cv.get("complete") else None
    if pl and pl.get("found") and "is_mayhem_mode" in pl:
        flags.append(pl.get("is_mayhem_mode"))
    if cv.get("found") and (F.get("mint") or {}).get("supply_raw") and F["mint"]["supply_raw"] > C.PUMP_TOTAL_SUPPLY_RAW * 1.001:
        flags.append(True)
    cr.metrics = {"curve_flag": flags[0], "flags": flags}
    if True in flags:
        cr.add("MAYHEM_MODE", SEV_FAIL, observed=True, threshold=False, message="owner rule: hard-skip Mayhem coins")
    elif flags[0] is None:
        cr.add("MAYHEM_UNKNOWN", SEV_UNKNOWN, message="curve Mayhem flag unreadable")
    return cr.finish()


def check_market(F, T, now, cfg):
    cr = CheckResult("market")
    cv = _fact(F, "curve", now, cfg.max_fast_age_s, cr, "CURVE")
    px = _fact(F, "sol_usd", now, 120, cr, "SOL_PRICE")
    m = F.get("market_onchain") or {}
    dx = F.get("dex") or {}
    if cv is None or px is None:
        return cr.finish()
    if cv.get("complete"):
        _fact(F, "pool", now, cfg.max_fast_age_s, cr, "POOL")
    mc, liq = m.get("market_cap_usd"), m.get("liquidity_usd")
    cr.metrics = {"market_cap_usd": mc, "liquidity_usd": liq, "sol_usd": px.get("price"), "mcap_source": "onchain_reserves",
                  "dex_market_cap_usd": dx.get("market_cap_usd"), "dex_liquidity_usd": dx.get("liquidity_usd")}
    if dx and not dx.get("error"):
        cr.sources += dx.get("sources", [])
    if mc is None:
        cr.add("MCAP_UNKNOWN", SEV_UNKNOWN, message="market cap not computable from reserves")
        return cr.finish()
    if mc < T.min_market_cap_usd:
        cr.add("MCAP_BELOW_FLOOR", SEV_FAIL, observed=mc, threshold=T.min_market_cap_usd, message="owner rule: market cap >= $30k")
    if liq is not None and liq < T.min_liquidity_usd:
        cr.add("LIQUIDITY_BELOW_FLOOR", SEV_FAIL, observed=liq, threshold=T.min_liquidity_usd)
    dmc = dx.get("market_cap_usd") if dx else None
    if dmc:
        ratio = max(mc, dmc) / max(1e-9, min(mc, dmc))
        cr.metrics["mcap_divergence"] = round(ratio, 3)
        if ratio > T.max_mcap_source_divergence:
            cr.add("MCAP_SOURCES_DISAGREE", SEV_UNKNOWN, observed=round(ratio, 3), threshold=T.max_mcap_source_divergence)
    else:
        cr.add("DEX_CROSSCHECK_UNAVAILABLE", SEV_INFO, message="DexScreener cross-check missing; on-chain value used")
    return cr.finish()


def _excluded_owners(F):
    ex = dict(C.INFRA_OWNERS)
    cv, pl = F.get("curve") or {}, F.get("pool") or {}
    for k, lab in ((cv.get("curve_address"), "bonding_curve"), (pl.get("pool_address"), "pumpswap_pool"), (pl.get("pool_authority"), "pool_authority")):
        if k:
            ex[k] = lab
    ex.update({o: f"program_owned:{p}" for o, p in (F.get("program_owned") or {}).items()})
    return ex


def holder_metrics(F):
    bal = dict(((F.get("holders") or {}).get("balances")) or {})
    ex = _excluded_owners(F)
    supply = (F.get("mint") or {}).get("supply_raw") or C.PUMP_TOTAL_SUPPLY_RAW
    excluded = {o: bal.pop(o) for o in list(bal) if o in ex}
    ranked = sorted(bal.items(), key=lambda kv: -kv[1])
    top10 = ranked[:10]
    creator = (F.get("curve") or {}).get("creator")
    return {"holder_count": len(bal), "top10_pct": round(100 * sum(v for _, v in top10) / supply, 3),
            "top1_pct": round(100 * top10[0][1] / supply, 3) if top10 else 0.0,
            "creator_pct": round(100 * bal.get(creator, 0) / supply, 3) if creator else None,
            "excluded": [{"label": ex[o], "pct": round(100 * v / supply, 3)} for o, v in excluded.items()],
            "balances": bal, "supply_raw": supply}


def check_holders(F, T, now, cfg):
    cr = CheckResult("holders")
    h = _fact(F, "holders", now, cfg.max_holders_age_s, cr, "HOLDERS")
    cv = _fact(F, "curve", now, cfg.max_fast_age_s, cr, "CURVE")
    if h is not None and cv is not None:
        if cv.get("complete") and not F.get("pool"):
            cr.add("POOL_MISSING_FOR_EXCLUSION", SEV_UNKNOWN)
        hm = holder_metrics(F)
        cr.metrics = {k: v for k, v in hm.items() if k != "balances"}
        if hm["holder_count"] < T.min_holder_count:
            cr.add("HOLDER_COUNT_LOW", SEV_FAIL, observed=hm["holder_count"], threshold=T.min_holder_count)
        if hm["top10_pct"] > T.max_top10_pct:
            cr.add("TOP10_TOO_HIGH", SEV_FAIL, observed=hm["top10_pct"], threshold=T.max_top10_pct, message="top-10 % of supply excl. curve/pool/infra")
        if hm["top1_pct"] > T.max_top1_pct:
            cr.add("TOP1_TOO_HIGH", SEV_FAIL, observed=hm["top1_pct"], threshold=T.max_top1_pct)
        if hm["creator_pct"] is not None and hm["creator_pct"] > T.max_creator_pct:
            cr.add("CREATOR_HOLDS_TOO_MUCH", SEV_FAIL, observed=hm["creator_pct"], threshold=T.max_creator_pct)
    fr = F.get("fresh")
    if fr is None or fr.get("error"):
        cr.add("FRESH_RATIO_UNKNOWN", SEV_INFO, observed=(fr or {}).get("error"), message="early-buyer traces unavailable (fresh ratio is informational)")
    else:
        cr.latency_ms = max(cr.latency_ms or 0, fr.get("latency_ms") or 0)
        ratio, known = fr.get("fresh_wallet_ratio"), fr.get("buyers_with_history") or 0
        cr.metrics.update({"fresh_wallet_ratio": ratio, "fresh_known_buyers": known, "fresh_supply_pct": fr.get("fresh_supply_pct")})
        # WARN only: on 1,960 labeled launches a high fresh ratio had a LOWER bad rate at every threshold (0.5-1.0).
        if ratio is None or known < T.min_fresh_known_buyers:
            cr.add("FRESH_RATIO_UNKNOWN", SEV_INFO, observed=known, threshold=T.min_fresh_known_buyers, message="too few buyers with complete history")
        elif ratio >= T.max_fresh_wallet_ratio:
            cr.add("FRESH_WALLET_RATIO_HIGH", SEV_WARN, observed=ratio, threshold=T.max_fresh_wallet_ratio, message="informational (inverted in data)")
    return cr.finish()


def check_bundle_sniper(F, T, now, cfg):
    cr = CheckResult("bundle_sniper")
    e = _fact(F, "early", now, cfg.slow_ttl_s, cr, "EARLY_BUYERS")
    if e is None:
        return cr.finish()
    if not e.get("history_complete") or not (e.get("creation") or {}).get("is_create_ix"):
        cr.add("CREATION_NOT_REACHED", SEV_UNKNOWN, observed=e.get("window_txs_total"),
               message="mint history too long or create tx not found; first buyers unknown")
        return cr.finish()
    buyers = [b for b in e.get("buyers", []) if not b["is_creator"]]
    same = [b for b in buyers if b["same_slot_as_create"]]
    snipers = [b for b in buyers if 0 <= b["slot_offset"] <= 2]
    same_pct = round(sum(b["pct_supply_bought"] for b in same), 3)
    sn_pct = round(sum(b["pct_supply_bought"] for b in snipers), 3)
    hm = holder_metrics(F) if (F.get("holders") or {}).get("balances") is not None and not (F.get("holders") or {}).get("error") else None
    held = round(100 * sum(hm["balances"].get(b["wallet"], 0) for b in snipers) / hm["supply_raw"], 3) if hm else None
    cr.metrics = {"early_window_s": e.get("window_s"), "n_early_buyers": len(e.get("buyers", [])), "same_slot_buyers": len(same), "same_slot_supply_pct": same_pct, "sniper_wallets_2slots": len(snipers),
                  "sniper_supply_bought_pct": sn_pct, "sniper_held_now_pct": held,
                  "early_buyers_supply_pct": round(sum(b["pct_supply_bought"] for b in e.get("buyers", [])), 3)}
    if len(same) >= T.max_same_slot_buyers:
        cr.add("SAME_SLOT_BUNDLE", SEV_FAIL, observed=len(same), threshold=T.max_same_slot_buyers, message="non-creator buyers in the create slot")
    if same_pct >= T.max_same_slot_supply_pct:
        cr.add("SAME_SLOT_SUPPLY_HIGH", SEV_FAIL, observed=same_pct, threshold=T.max_same_slot_supply_pct)
    if sn_pct >= T.max_sniper_supply_bought_pct:
        cr.add("SNIPER_SUPPLY_BOUGHT_HIGH", SEV_FAIL, observed=sn_pct, threshold=T.max_sniper_supply_bought_pct)
    if held is None:
        cr.add("SNIPER_HELD_UNKNOWN", SEV_UNKNOWN, message="current holder list unavailable")
    elif held >= T.max_sniper_held_now_pct:
        cr.add("SNIPER_HOLDS_HIGH", SEV_FAIL, observed=held, threshold=T.max_sniper_held_now_pct)
    return cr.finish()


def check_creator_history(F, T, now, cfg):
    cr = CheckResult("creator_history")
    s = _fact(F, "serial", now, cfg.slow_ttl_s, cr, "SERIAL")
    if s is None:
        return cr.finish()
    cov = s.get("coverage") or {}
    n, bad = s.get("total_created_other"), s.get("bad_outcome_ratio")
    measured = sum(v for k, v in (s.get("outcomes") or {}).items() if k not in ("unknown", "too_young"))
    cr.metrics = {"prior_launches": n, "lookback_h": s.get("lookback_hours"), "outcomes": s.get("outcomes"), "bad_outcome_ratio": bad, "measured": measured,
                  "coverage": cov, "creator": (F.get("curve") or {}).get("creator")}
    if n is None or s.get("error"):
        cr.add("SERIAL_UNAVAILABLE", SEV_UNKNOWN, observed=s.get("error"))
        return cr.finish()
    if not cov.get("wallet_history_complete") or not cov.get("stream_complete"):
        cr.add("SERIAL_COVERAGE_INCOMPLETE", SEV_UNKNOWN, observed=cov, message="creator history or create-stream index incomplete")
    if n >= T.max_prior_launches:   # WARN only: >= 10 prior launches had bad rate 4.9% vs 12.9% (n=2,051): inverted
        cr.add("SERIAL_DEPLOYER", SEV_WARN, observed=n, threshold=T.max_prior_launches, message="informational (inverted in data)")
    if bad is not None and measured >= T.min_measured_for_ratio and bad >= T.max_bad_outcome_ratio:
        cr.add("PRIOR_RUGS", SEV_FAIL, observed=bad, threshold=T.max_bad_outcome_ratio, message="share of measured prior launches rugged or died")
    return cr.finish()


def check_funding_cluster(F, T, now, cfg):
    cr = CheckResult("funding_cluster")
    e = _fact(F, "early", now, cfg.slow_ttl_s, cr, "EARLY_BUYERS")
    t = _fact(F, "traces", now, cfg.slow_ttl_s, cr, "TRACES")
    cl = F.get("clusters")
    if e is None or t is None:
        return cr.finish()
    if not e.get("history_complete") or not (e.get("creation") or {}).get("is_create_ix"):
        cr.add("CREATION_NOT_REACHED", SEV_UNKNOWN)
        return cr.finish()
    cov = t.get("coverage")
    cr.metrics = {"trace_coverage": cov, "wallets_traced": t.get("wallets"), "hops": t.get("hops")}
    if cov is None or cov < T.min_trace_coverage:
        cr.add("TRACE_COVERAGE_LOW", SEV_UNKNOWN, observed=cov, threshold=T.min_trace_coverage)
    if not cl:
        cr.add("CLUSTERS_MISSING", SEV_UNKNOWN)
        return cr.finish()
    big, dep = cl.get("largest_cluster_supply_pct") or 0, cl.get("deployer_cluster_supply_pct")
    cr.metrics.update({"n_clusters": cl.get("n_clusters"), "largest_cluster_supply_pct": big, "deployer_cluster_supply_pct": dep,
                       "clustered_buyer_ratio": cl.get("clustered_buyer_ratio"), "multisend_funders": len(cl.get("multisend_funders") or [])})
    if big >= T.max_cluster_supply_pct:
        cr.add("FUNDER_CLUSTER_SUPPLY_HIGH", SEV_FAIL, observed=big, threshold=T.max_cluster_supply_pct, message="wallets sharing a funder bought/hold this % of supply")
    if dep is not None and dep >= T.max_deployer_cluster_supply_pct:
        cr.add("DEPLOYER_CLUSTER_SUPPLY_HIGH", SEV_FAIL, observed=dep, threshold=T.max_deployer_cluster_supply_pct)
    return cr.finish()


ALL = {"input": check_input, "authority": check_authority, "mayhem": check_mayhem, "market": check_market, "holders": check_holders,
       "bundle_sniper": check_bundle_sniper, "creator_history": check_creator_history, "funding_cluster": check_funding_cluster}
