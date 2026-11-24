"""Low-level signal extractors (point-in-time where the data allows):
  same_slot_buys        bundle evidence from early buyers
  deployer_proxy        fee payer vs creator, deployer age at creation, deployer funders
  fresh_wallets         early buyers whose first-ever tx is < N hours before their buy (anchored search)
  holder_concentration  top-10 share excl. curve/pool/burn/program-owned; from as-of holdings or getProgramAccounts
  mint_authorities      mint & freeze authority
  serial_deployer       prior coins of the deployer created before as_of, outcomes MEASURED on-chain
  liquidity             curve state at as_of (+ DexScreener / pump.fun in live mode)
"""
from __future__ import annotations
import base64, struct
from concurrent.futures import ThreadPoolExecutor
from . import chain, config as C, logging_setup as L
from .sources.rpc import RpcError

log = L.get("extract")


def same_slot_buys(early):
    buyers = early.get("buyers", [])
    nc = [b for b in buyers if not b["is_creator"]]
    same = [b for b in nc if b["same_slot_as_create"]]
    within2 = [b for b in nc if 0 <= b["slot_offset"] <= 2]
    creator = next((b for b in buyers if b["is_creator"]), None)
    return {"same_slot_buyer_count": len(same), "same_slot_wallets": [b["wallet"] for b in same],
            "same_slot_supply_pct": round(sum(b["pct_supply_bought"] for b in same), 3),
            "within_2_slots_count": len(within2), "within_2_slots_supply_pct": round(sum(b["pct_supply_bought"] for b in within2), 3),
            "creator_initial_buy_pct": creator["pct_supply_bought"] if creator else 0.0,
            "early_buyers_supply_pct": round(sum(b["pct_supply_bought"] for b in buyers), 3), "n_early_buyers": len(buyers)}


def deployer_proxy(early, traces):
    c = early.get("creation") or {}
    creator = early.get("creator")
    t = traces.get(creator) or {}
    info = t.get("info") or {}
    fs = t.get("funders") or []
    ct, first = c.get("block_time"), info.get("first_block_time")
    return {"creator": creator, "creation_fee_payer": c.get("fee_payer"), "fee_payer_is_creator": c.get("fee_payer_is_creator"),
            "deployer_sigs_before_create": info.get("sigs_scanned"), "deployer_history_complete": bool(info.get("history_complete")),
            "deployer_is_hub": bool(info.get("is_hub")),
            "deployer_age_hours_at_create": round((ct - first) / 3600, 2) if (ct and first) else None,
            "deployer_funders": [{"funder": f["funder"], "sol": round(f["lamports"] / 1e9, 4), "label": f.get("label"),
                                  "funder_is_hub": f.get("funder_is_hub"), "in_window": f.get("in_window")} for f in fs],
            "deployer_primary_funder": fs[0]["funder"] if fs else None,
            "deployer_funded_by_cex": any(f.get("non_linking") for f in fs)}


def fresh_wallets(early, traces, fresh_hours):
    rows, known = [], 0
    for b in early.get("buyers", []):
        if b["is_creator"]:
            continue
        info = (traces.get(b["wallet"]) or {}).get("info")
        if not info:
            continue
        known += 1
        first = info.get("first_block_time")
        if info.get("history_complete") and first and b.get("block_time"):
            age = (b["block_time"] - first) / 3600
            if age <= fresh_hours:
                rows.append({"wallet": b["wallet"], "age_hours_at_buy": round(age, 2), "prior_sigs": info.get("sigs_scanned"),
                             "pct_supply_bought": b["pct_supply_bought"]})
    return {"fresh_wallet_count": len(rows), "buyers_with_history": known,
            "fresh_wallet_ratio": round(len(rows) / known, 3) if known else None,
            "fresh_supply_pct": round(sum(r["pct_supply_bought"] for r in rows), 3), "fresh_wallets": rows, "fresh_hours": fresh_hours}


def mint_authorities(ctx, mint):
    acc = (ctx.rpc.get_account_info(mint) or {}).get("value") or {}
    info = (((acc.get("data") or {}).get("parsed") or {}).get("info")) or {}
    return {"token_program": acc.get("owner"), "mint_authority": info.get("mintAuthority"), "freeze_authority": info.get("freezeAuthority"),
            "decimals": info.get("decimals"), "supply_raw": int(info["supply"]) if info.get("supply") else None,
            "mint_authority_revoked": info.get("mintAuthority") in (None, ""), "freeze_authority_revoked": info.get("freezeAuthority") in (None, ""),
            "found": bool(acc)}


def _program_owned(ctx, owners):
    out = {}
    try:
        for o, a in zip(owners, ctx.rpc.get_multiple_accounts(owners)):
            prog = (a or {}).get("owner")
            if a and prog not in (C.SYSTEM_PROGRAM, None):
                out[o] = prog
    except RpcError:
        pass
    return out


def holder_concentration(ctx, mint, early, coin, auth, live):
    """Prefer exact point-in-time holdings reconstructed from every tx up to as_of; in live mode for older tokens
    fall back to the full current holder list via getProgramAccounts."""
    creator = early.get("creator")
    excluded_owners = dict(C.INFRA_OWNERS)
    for k in ("bonding_curve", "pool_address"):
        if coin.get(k) or early.get(k):
            excluded_owners[coin.get(k) or early.get(k)] = k
    warnings, balances, source = [], {}, None
    if early.get("holdings_complete"):
        balances, source = dict(early.get("holdings_as_of") or {}), "tx_reconstruction_as_of"
    elif live:
        try:
            for a in ctx.rpc.get_token_accounts_for_mint(mint, auth.get("token_program") or C.TOKEN_2022_PROGRAM):
                info = a["account"]["data"]["parsed"]["info"]
                amt = int(info["tokenAmount"]["amount"])
                if amt > 0:
                    balances[info["owner"]] = balances.get(info["owner"], 0) + amt
            source = "getProgramAccounts_current"
        except (RpcError, KeyError, TypeError) as e:
            warnings.append(f"getProgramAccounts failed: {e}")
    else:
        warnings.append("point-in-time holdings incomplete (too many txs before as_of); holder rules degrade")
    if source is None:
        return {"source": None, "warnings": warnings, "balances": {}}
    excluded = {o: balances.pop(o) for o in list(balances) if o in excluded_owners}
    ranked = sorted(balances.items(), key=lambda kv: -kv[1])
    po = _program_owned(ctx, [o for o, _ in ranked[:15]])
    for o, prog in po.items():
        excluded[o] = balances.pop(o); excluded_owners[o] = f"program_owned:{prog}"
    ranked = sorted(balances.items(), key=lambda kv: -kv[1])
    top10 = ranked[:10]
    supply = C.PUMP_TOTAL_SUPPLY_RAW
    circ = supply - sum(excluded.values())
    return {"source": source, "holder_count": len(balances),
            "top10_pct_of_supply": round(100 * sum(v for _, v in top10) / supply, 3),
            "top10_pct_of_circulating": round(100 * sum(v for _, v in top10) / circ, 3) if circ > 0 else None,
            "top1_pct_of_supply": round(100 * top10[0][1] / supply, 3) if top10 else 0.0,
            "creator_pct_of_supply": round(100 * balances.get(creator, 0) / supply, 3) if creator else None,
            "excluded_accounts": [{"owner": o, "label": excluded_owners.get(o), "pct_of_supply": round(100 * v / supply, 3)} for o, v in excluded.items()],
            "top10": [{"owner": o, "pct_of_supply": round(100 * v / supply, 3)} for o, v in top10],
            "balances": balances, "warnings": warnings}


# ---------------- serial deployer: on-chain, point-in-time, with measured outcomes ----------------
OUTCOME_HORIZON_S = 24 * 3600
MIN_OUTCOME_AGE_S = 2 * 3600


def _curve_ratios(ctx, curve, mint, created, T, k=8):
    a = ctx.anchors.anchor_at(int(T), max_pages=0)
    if not a:
        return None, 0
    sigs, before = [], a["signature"]
    for _ in range(3):
        page = ctx.rpc.get_signatures(curve, 1000, before=before)
        sigs += page
        if len(page) < 1000 or (page[-1].get("blockTime") or 0) <= created:
            break
        before = page[-1]["signature"]
    win = [x for x in sigs if x.get("err") is None and x.get("blockTime") and created - 5 <= x["blockTime"] <= T]
    if not win:
        return [], 0
    win.sort(key=lambda x: (x["slot"], x.get("transactionIndex") or 0))
    idx = sorted({round(i * (len(win) - 1) / (k - 1)) for i in range(k)}) if len(win) > k else list(range(len(win)))
    out = []
    for i in idx:
        try:
            tx = ctx.rpc.get_transaction(win[i]["signature"], block_time=win[i].get("blockTime"))
        except RpcError:
            continue
        ct = chain.token_post_balance(tx, mint, curve) if tx and tx.get("meta") else None
        if ct is not None:
            out.append(ct)
    return out, len(win)


def prior_coin_outcome(ctx, prior, t0):
    """Outcome of a deployer's earlier coin, measured from its bonding-curve transactions up to
    T = min(created + 24h, t0) only (no lookahead). Classes:
      graduated   curve reached completion
      rugged      peak >= 3x launch price and last sample <= 35% of peak
      died_flat   peak < 3x and last sample < 1.5x launch price
      alive       otherwise
      too_young   < 2h of history before t0 (excluded from ratios)
      unknown     data unavailable"""
    mint, curve, created = prior.get("mint"), prior.get("curve"), prior.get("created") or 0
    T = min(created + OUTCOME_HORIZON_S, t0)
    base = {"mint": mint, "created": int(created), "measured_until": int(T), "class": "unknown"}
    if not mint or not curve or not created:
        return base
    if T - created < MIN_OUTCOME_AGE_S:
        return {**base, "class": "too_young"}
    try:
        bals, n = _curve_ratios(ctx, curve, mint, created, T)
    except RpcError:
        return base
    if not bals:
        return base
    ratios = [chain.price_ratio_vs_launch(b) for b in bals]
    peak, final = max(ratios), ratios[-1]
    graduated = any(chain.curve_real_tokens(b) == 0 for b in bals)
    cls = ("graduated" if graduated else "rugged" if peak >= 3 and final <= 0.35 * peak
           else "died_flat" if peak < 3 and final < 1.5 else "alive")
    return {**base, "class": cls, "n_trades_in_window": n, "peak_x_launch": round(peak, 2), "final_x_launch": round(final, 2)}


def _create_info(ctx, sig):
    try:
        tx = ctx.rpc.get_transaction(sig)
    except RpcError:
        return None
    if not tx or not tx.get("meta") or tx["meta"].get("err"):
        return None
    if not chain.is_create(tx):
        return None
    mint = next((b["mint"] for b in tx["meta"].get("postTokenBalances") or [] if int(b["uiTokenAmount"]["amount"]) >= 5 * 10**14), None)
    curve = chain.curve_from_create(tx, mint) if mint else None
    if not curve:
        return None
    return {"create_sig": sig, "mint": mint, "curve": curve, "created": tx.get("blockTime")}


def serial_deployer(ctx, wallet, t0, exclude_sig=None, measure=True):
    """Prior pump.fun launches by `wallet` in the `serial_lookback_hours` before t0, found on-chain:
    the wallet's signatures before t0 (as-of anchored) intersected with the pump mint-authority create
    stream. Exact and point-in-time when both histories are complete; flags partial coverage otherwise.
    The pump.fun API lifetime count is reported for information only (it is incomplete and not as-of)."""
    if not wallet:
        return None
    s = ctx.settings
    lo = int(t0 - s.serial_lookback_hours * 3600)
    out = {"wallet": wallet, "lookback_hours": s.serial_lookback_hours, "total_created_other": None, "prior_creates": [],
           "outcomes": {}, "measured": [], "bad_outcome_ratio": None, "coverage": {}, "source": "onchain_stream_intersection"}
    try:
        cov = ctx.anchors.ensure_range(lo, int(t0))
        a = ctx.anchors.anchor_at(int(t0), max_pages=0)
        sigs, before, complete = [], a["signature"] if a else None, False
        for _ in range(3):
            page = ctx.rpc.get_signatures(wallet, 1000, before=before)
            sigs += page
            if len(page) < 1000 or (page[-1].get("blockTime") or 0) < lo:
                complete = True; break
            before = page[-1]["signature"]
    except RpcError as e:
        out["error"] = str(e)[:200]
        return out
    sigs = [x for x in sigs if x.get("err") is None and x.get("blockTime") and lo <= x["blockTime"] <= t0]
    creates = ctx.anchors.sigs_in(x["signature"] for x in sigs)
    out["coverage"] = {"stream_complete": cov["complete"], "wallet_history_complete": complete, "wallet_sigs_in_window": len(sigs)}
    prior = [x for x in sigs if x["signature"] in creates]
    prior = [x for x in prior if x["signature"] != exclude_sig]
    out["total_created_other"] = len(prior)
    infos = []
    if measure and prior:
        with ThreadPoolExecutor(4) as ex:
            infos = [i for i in ex.map(lambda x: _create_info(ctx, x["signature"]), prior[: s.serial_prior_coins_checked]) if i]
    out["prior_creates"] = [{"mint": i["mint"], "created": i["created"]} for i in infos]
    if measure and infos:
        with ThreadPoolExecutor(4) as ex:
            res = list(ex.map(lambda i: prior_coin_outcome(ctx, i, t0), infos))
        for r in res:
            out["outcomes"][r["class"]] = out["outcomes"].get(r["class"], 0) + 1
        known = [r for r in res if r["class"] not in ("unknown", "too_young")]
        bad = sum(1 for r in known if r["class"] in ("rugged", "died_flat"))
        out["bad_outcome_ratio"] = round(bad / len(known), 3) if known else None
        out["measured"] = res
    try:
        j = ctx.pumpfun.created_by(wallet, limit=1)
        out["api_lifetime_count_info"] = (j or {}).get("count")
    except Exception:
        pass
    return out


def _curve_k(ctx, curve):
    try:
        v = (ctx.rpc.get_account_info(curve, encoding="base64") or {}).get("value")
        d = base64.b64decode(v["data"][0])
        vt, vs, rt, rs, ts = struct.unpack("<QQQQQ", d[8:48])
        return vt * vs if vt and vs and not d[48] else None
    except Exception:
        return None


def liquidity(ctx, mint, coin, early, live):
    q = coin.get("quote_mint") or C.SYSTEM_PROGRAM
    sol_quote = q in (C.SYSTEM_PROGRAM, C.WSOL_MINT)
    out = {"quote_mint": q, "curve_as_of": early.get("curve_as_of"), "curve_real_quote_as_of": None, "market_cap_quote_as_of": None,
           "market_cap_usd": None, "best_liquidity_usd": None, "dex_pairs": [], "source": []}
    ca = early.get("curve_as_of")
    curve = early.get("bonding_curve")
    if ca and curve and not ca["graduated"]:
        k = _curve_k(ctx, curve)
        if k:
            vt = chain.curve_real_tokens(ca["curve_token_raw"]) + C.PUMP_VIRTUAL_TOKEN_OFFSET_RAW
            vs = k / vt
            vs0 = k / (C.PUMP_INITIAL_REAL_TOKEN_RAW + C.PUMP_VIRTUAL_TOKEN_OFFSET_RAW)
            dec = 9 if sol_quote else (coin.get("quote_decimals") or 6)
            out["curve_real_quote_as_of"] = round((vs - vs0) / 10 ** dec, 4)
            out["market_cap_quote_as_of"] = round(vs / vt * C.PUMP_TOTAL_SUPPLY_RAW / 10 ** dec, 4)
            out["source"].append("bonding_curve_reserves")
    if live:
        out["market_cap_usd"] = coin.get("usd_market_cap")
        liqs = [coin.get("canonical_pool_liquidity_usd") or 0]
        try:
            for p in ctx.dex.token_pairs(mint)[:5]:
                out["dex_pairs"].append({"dex": p.get("dexId"), "pair": p.get("pairAddress"), "liquidity_usd": (p.get("liquidity") or {}).get("usd"),
                                         "volume_h24": (p.get("volume") or {}).get("h24"), "price_usd": p.get("priceUsd")})
                liqs.append((p.get("liquidity") or {}).get("usd") or 0)
            out["source"].append("dexscreener")
        except Exception as e:
            out["dexscreener_error"] = str(e)[:200]
        if sol_quote and out["curve_real_quote_as_of"] is not None:
            sol_usd = sol_price_usd(ctx)
            if sol_usd:
                liqs.append(2 * out["curve_real_quote_as_of"] * sol_usd)
        out["best_liquidity_usd"] = round(max(liqs), 2) if max(liqs) > 0 else None
    return out


def sol_price_usd(ctx):
    try:
        pairs = ctx.dex.token_pairs(C.WSOL_MINT, ttl=300)
        ps = [float(p["priceUsd"]) for p in pairs if (p.get("baseToken") or {}).get("address") == C.WSOL_MINT
              and (p.get("quoteToken") or {}).get("symbol") in ("USDC", "USDT") and p.get("priceUsd")]
        return sorted(ps)[len(ps) // 2] if ps else None
    except Exception:
        return None
