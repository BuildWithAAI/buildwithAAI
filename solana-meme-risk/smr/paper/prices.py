"""Market quotes from DexScreener (primary, batch of 30) and GeckoTerminal (fallback / missing liquidity).
Never invents a price: a mint with no valid quote is simply absent from the result (the caller keeps it pending)."""
from __future__ import annotations
import math, time
from dataclasses import dataclass, asdict
from .. import logging_setup as L
from ..momentum import from_dex_pair, from_gt_pool

log = L.get("paper.prices")
DEX_BATCH = 30
GT_BATCH = 30


@dataclass
class Quote:
    mint: str
    price_usd: float
    mcap_usd: float | None
    liquidity_usd: float | None
    source: str
    pair: str | None = None
    dex: str | None = None
    symbol: str | None = None     # raw, untrusted: sanitize before use
    name: str | None = None       # raw, untrusted
    at: float = 0.0
    fdv_usd: float | None = None      # GeckoTerminal fdv (uses on-chain total supply); DexScreener fdv assumes 1B for pump tokens
    price_native: float | None = None  # quote-token (SOL) per token, DexScreener priceNative
    quote_symbol: str | None = None
    gt_price_usd: float | None = None  # cross-check price when both sources answered
    mom_raw: dict | None = None        # numeric DexScreener txns/volume/priceChange (smr.momentum.from_dex_pair)
    gt_pool: dict | None = None        # numeric GeckoTerminal top-pool unique buyers/sellers (entry quotes only)

    def as_dict(self):
        return asdict(self)


def _num(x):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) and v > 0 else None


def pick_pair(mint, pairs):
    """Best DexScreener pair for `mint` as base token: highest USD liquidity; pairs without liquidity info
    (pump.fun bonding curve) only when nothing else has a price."""
    mine = [p for p in pairs or [] if (p.get("baseToken") or {}).get("address") == mint and _num(p.get("priceUsd"))]
    if not mine:
        return None
    key = lambda p: (_num((p.get("liquidity") or {}).get("usd")) or 0, p.get("dexId") != "pumpfun")
    # s52: a side pool whose listed liquidity is implausibly small for its market cap (same rule as
    # gates.quote_sanity, e.g. 2QUUWXGM's fake $343M PumpSwap pool) loses to any other priced pair,
    # so the entry gets the real (often bonding-curve) price instead of waiting. If every pair fails, keep
    # the old choice; the entry gate then keeps it pending.
    from .gates import quote_sanity
    sane = [p for p in mine if quote_sanity(_num((p.get("liquidity") or {}).get("usd")), _num(p.get("marketCap")) or _num(p.get("fdv"))) is None]
    return max(sane or mine, key=key)


def dexscreener_quotes(ctx, mints, now=None):
    now = now or time.time()
    out, errors = {}, []
    mints = list(dict.fromkeys(mints))
    for i in range(0, len(mints), DEX_BATCH):
        chunk = mints[i:i + DEX_BATCH]
        try:
            pairs = ctx.dex.h.get_json(f"/tokens/v1/solana/{','.join(chunk)}", ttl=0) or []
        except Exception as e:
            errors.append(f"dexscreener: {e}"[:200]); continue
        if isinstance(pairs, dict):
            pairs = pairs.get("pairs") or []
        for m in chunk:
            p = pick_pair(m, pairs)
            if p:
                bt = p.get("baseToken") or {}
                out[m] = Quote(m, _num(p.get("priceUsd")), _num(p.get("marketCap")) or _num(p.get("fdv")),
                               _num((p.get("liquidity") or {}).get("usd")), "dexscreener", p.get("pairAddress"), p.get("dexId"),
                               bt.get("symbol"), bt.get("name"), now, _num(p.get("fdv")), _num(p.get("priceNative")),
                               (p.get("quoteToken") or {}).get("symbol"), mom_raw=from_dex_pair(p))
    return out, errors


def geckoterminal_tokens(ctx, mints, now=None, include_pools=False):
    """include_pools: same single batch call with include=top_pools, which adds each token's top pool (unique
    buyers/sellers for the momentum signal) at no extra request."""
    now = now or time.time()
    out, errors = {}, []
    mints = list(dict.fromkeys(mints))
    for i in range(0, len(mints), GT_BATCH):
        chunk = mints[i:i + GT_BATCH]
        try:
            j = ctx.gt.h.get_json(f"/networks/solana/tokens/multi/{','.join(chunk)}" + ("?include=top_pools" if include_pools else ""), ttl=0) or {}
        except Exception as e:
            errors.append(f"geckoterminal: {e}"[:200]); continue
        pools = {x.get("id"): x.get("attributes") for x in (j.get("included") or []) if isinstance(x, dict) and x.get("type") == "pool"}
        for d in j.get("data") or []:
            a = d.get("attributes") or {}
            m = a.get("address")
            px = _num(a.get("price_usd"))
            if m in chunk and px:
                out[m] = Quote(m, px, _num(a.get("market_cap_usd")) or _num(a.get("fdv_usd")), _num(a.get("total_reserve_in_usd")),
                               "geckoterminal", None, None, a.get("symbol"), a.get("name"), now, _num(a.get("fdv_usd")), None, None, px)
                tp = (((d.get("relationships") or {}).get("top_pools") or {}).get("data") or [])
                if tp and isinstance(tp[0], dict):
                    out[m].gt_pool = from_gt_pool(pools.get(tp[0].get("id")))
    return out, errors


def quotes(ctx, mints, now=None, use_gt=True, gt_all=False):
    """{mint: Quote} for every mint that has a valid price now; plus error strings. DexScreener first;
    GeckoTerminal for mints DexScreener lacks (price) or where its liquidity is unknown (pump.fun curve), or for
    every mint with gt_all=True (entries: cross-check price + correct-supply FDV)."""
    out, errs = dexscreener_quotes(ctx, mints, now)
    need = [m for m in mints if gt_all or m not in out or out[m].liquidity_usd is None]
    if use_gt and need:
        gt, e2 = geckoterminal_tokens(ctx, need, now, include_pools=gt_all)
        errs += e2
        for m, q in gt.items():
            if m not in out:
                out[m] = q
            else:
                if out[m].liquidity_usd is None and q.liquidity_usd is not None:
                    out[m].liquidity_usd = q.liquidity_usd
                    out[m].source = "dexscreener+gt_liquidity"
                elif q.liquidity_usd is not None and q.liquidity_usd > out[m].liquidity_usd:
                    # same rule as the live scorer: best known liquidity across sources
                    out[m].liquidity_usd = q.liquidity_usd
                    out[m].source = "dexscreener+gt_liquidity"
                out[m].gt_price_usd = q.price_usd
                if q.gt_pool:
                    out[m].gt_pool = q.gt_pool
                if q.fdv_usd:
                    out[m].fdv_usd = q.fdv_usd
                if out[m].mcap_usd is None:
                    out[m].mcap_usd = q.mcap_usd
    return out, errs
