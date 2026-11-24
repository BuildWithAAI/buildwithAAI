"""Outcome labels measured on-chain (no third-party price feed needed).

Price is expressed as a multiple of the pump.fun launch price:
  * on the bonding curve: ratio = ((793.1e12 + 279.9e12) / (curve_real_tokens + 279.9e12))^2 from the curve's
    token balance after its last successful transaction before T (found with an as-of anchor);
  * after graduation (curve token balance 0): ratio = curve_final_ratio * pool_price(T) / pool_price(migration),
    where pool prices are the PumpSwap pool's quote/base vault balances (pool-owned token accounts) after the
    pool's last tx before T and in the migration tx.

LABEL DEFINITION (primary, `bad_24h`, label_version "bad24:v1"): entry = price at as_of (= create + 300 s),
    loss50_24h = price(as_of+24h) <= 0.5 * entry                       (>= 50% loss if held 24h)
    dead_24h   = not graduated and price(as_of+24h) <= 1.10 * launch price and price(as_of+24h) <= 0.8 * entry
                 (curve back within 10% of the launch price = essentially all buy-side liquidity withdrawn;
                  needed because a curve price can never fall below the launch price, so a coin bought at
                  1.3x launch that goes to zero only shows a -23% "loss"; the <= -20% condition keeps coins that
                  simply never moved from the launch price out of the BAD class)
    bad_24h    = loss50_24h OR dead_24h
Also stored: loss50_/dead_/bad_ at 1h and 6h, crash_24h (<= 0.1 * entry), graduated_24h, raw returns.
Labels are only used for evaluation / threshold fitting, never as scorer inputs.
"""
from __future__ import annotations
from .. import chain, config as C, logging_setup as L
from ..sources.rpc import RpcError

log = L.get("bt.label")
HORIZONS = {"1h": 3600, "6h": 6 * 3600, "24h": 24 * 3600}
FINAL_CURVE_RATIO = chain.price_ratio_vs_launch(0)


def _last_tx_balance(ctx, address, mint, T, owner, quote_mint=None, tries=4):
    a = ctx.anchors.anchor_at(int(T), max_pages=0)
    if not a:
        return None, "no anchor"
    try:
        page = ctx.rpc.get_signatures(address, 25, before=a["signature"])
    except RpcError as e:
        return None, f"sigs: {e}"[:160]
    ok = [s for s in page if s.get("err") is None and (s.get("blockTime") or 0) <= T]
    for s in ok[:tries]:
        try:
            tx = ctx.rpc.get_transaction(s["signature"], block_time=s.get("blockTime"))
        except RpcError:
            continue
        if not tx or not tx.get("meta"):
            continue
        b = chain.token_post_balance(tx, mint, owner)
        if b is None:
            continue
        q = chain.token_post_balance(tx, quote_mint, owner) if quote_mint else None
        return {"sig": s["signature"], "block_time": s.get("blockTime"), "base": b, "quote": q}, None
    return None, "no balance-bearing tx" if ok else "no tx before T"


def price_ratio_at(ctx, mint, curve, pool, quote_mint, T, _mig_cache={}):
    c, err = _last_tx_balance(ctx, curve, mint, T, curve)
    if not c:
        return {"T": int(T), "ratio": None, "err": f"curve {err}"}
    if c["base"] > 0:
        return {"T": int(T), "ratio": chain.price_ratio_vs_launch(c["base"]), "venue": "curve", "tx_time": c["block_time"]}
    # graduated by T
    if not pool:
        return {"T": int(T), "ratio": None, "graduated": True, "err": "graduated, no pool address"}
    key = (mint, pool)
    if key not in _mig_cache:
        # migration tx = last curve tx (balance 0); pool balances right after migration: pool's first txs
        m, err = _last_tx_balance(ctx, pool, mint, (c["block_time"] or T) + 60, pool, quote_mint, tries=25)
        if not m or not m.get("quote"):
            return {"T": int(T), "ratio": None, "graduated": True, "err": f"migration price: {err}"}
        _mig_cache[key] = m
    m = _mig_cache[key]
    p, err = _last_tx_balance(ctx, pool, mint, T, pool, quote_mint)
    if not p or not p.get("quote") or not p.get("base"):
        return {"T": int(T), "ratio": None, "graduated": True, "err": f"pool price: {err}"}
    r = FINAL_CURVE_RATIO * (p["quote"] / p["base"]) / (m["quote"] / m["base"])
    return {"T": int(T), "ratio": r, "venue": "pumpswap", "graduated": True, "tx_time": p["block_time"]}


def classify(entry_ratio: float, ratio: float, graduated: bool) -> dict:
    """Label one horizon. Ratios are prices relative to the launch price (1.0 = first curve price)."""
    ret = ratio / entry_ratio
    loss50 = int(ret <= 0.5)
    dead = int(not graduated and ratio <= 1.10 and ret <= 0.8)
    return {"return": round(ret - 1, 4), "loss50": loss50, "dead": dead, "bad": int(loss50 or dead), "crash": int(ret <= 0.1)}


def label(ctx, cand, as_of, coin=None):
    mint, curve = cand["mint"], cand["curve"]
    coin = coin or {}
    pool = coin.get("pool_address")
    q = coin.get("quote_mint")
    quote_mint = C.WSOL_MINT if not q or q in (C.SYSTEM_PROGRAM, C.WSOL_MINT) else q
    entry = price_ratio_at(ctx, mint, curve, pool, quote_mint, as_of)
    out = {"mint": mint, "as_of": int(as_of), "entry": entry, "horizons": {}, "label_version": "bad24:v1"}
    if entry.get("ratio") is None:
        out["usable"] = False
        return out
    for h, dt in HORIZONS.items():
        r = price_ratio_at(ctx, mint, curve, pool, quote_mint, as_of + dt)
        out["horizons"][h] = r
        if r.get("ratio") is not None:
            c = classify(entry["ratio"], r["ratio"], bool(r.get("graduated")))
            r["return"] = c["return"]
            out[f"loss50_{h}"], out[f"dead_{h}"], out[f"bad_{h}"] = c["loss50"], c["dead"], c["bad"]
            if h == "24h":
                out["crash_24h"], out["graduated_24h"], out["return_24h"] = c["crash"], int(bool(r.get("graduated"))), c["return"]
    out["usable"] = "bad_24h" in out
    return out
