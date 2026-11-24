"""On-chain readers for the vet gate (free public RPC; no pump.fun API).

Layouts from pump-fun/pump-public-docs IDLs (fetched 2026-11-17) and verified on live accounts:
  BondingCurve (pump 6EF8..., PDA ["bonding-curve", mint]):
    8 disc | vtok u64 | vquote u64 | rtok u64 | rquote u64 | supply u64 | complete u8 @48 | creator @49..81 |
    is_mayhem_mode u8 @81 | is_cashback_coin u8 @82 | quote_mint @83..115 (all-zero = SOL) | ...
    Legacy 81-byte accounts predate the Mayhem field (= not Mayhem, SOL quote).
  PumpSwap Pool (pAMM..., canonical PDA ["pool", u16 0, pool_authority, mint, WSOL], pool_authority =
    pump PDA ["pool-authority", mint]):
    8 disc | bump u8 | index u16 | creator @11 | base_mint @43 | quote_mint @75 | lp_mint @107 |
    pool_base_ta @139 | pool_quote_ta @171 | lp_supply u64 @203 | coin_creator @211 | is_mayhem_mode u8 @243
  Migration burns the LP: the LP mint's on-chain supply is 0 for migrated pump coins (verified on 3 pools)."""
from __future__ import annotations
import base64, struct, time
from ..paper.pda import find_program_address, b58decode, b58encode, pump_bonding_curve
from .. import config as C

CURVE_DISC = bytes([23, 183, 248, 55, 96, 216, 172, 96])
ZERO_KEY = "11111111111111111111111111111111"
PUMP_POOL_AUTHORITY_SEED = b"pool-authority"
ALLOWED_T22_EXTENSIONS = {"metadataPointer", "tokenMetadata", "groupPointer", "groupMemberPointer", "tokenGroup",
                          "tokenGroupMember"}


def _b64(v):
    return base64.b64decode(v["data"][0]) if v and isinstance(v.get("data"), list) else None


def decode_curve(data: bytes) -> dict | None:
    if not data or len(data) < 81 or data[:8] != CURVE_DISC:
        return None
    vt, vq, rt, rq, sup = struct.unpack_from("<5Q", data, 8)
    out = {"virtual_token_reserves": vt, "virtual_quote_reserves": vq, "real_token_reserves": rt, "real_quote_reserves": rq,
           "token_total_supply": sup, "complete": bool(data[48]), "creator": b58encode(data[49:81]),
           "layout_len": len(data), "is_mayhem_mode": False, "is_cashback_coin": False, "quote_mint": "SOL"}
    if len(data) > 81:
        out["is_mayhem_mode"] = None if data[81] not in (0, 1) else bool(data[81])
    if len(data) > 82:
        out["is_cashback_coin"] = bool(data[82])
    if len(data) >= 115:
        q = b58encode(data[83:115])
        out["quote_mint"] = "SOL" if q in (ZERO_KEY, C.WSOL_MINT) else q
    return out


def decode_pool(data: bytes) -> dict | None:
    if not data or len(data) < 211:
        return None
    k = lambda o: b58encode(data[o:o + 32])
    out = {"creator": k(11), "base_mint": k(43), "quote_mint": k(75), "lp_mint": k(107), "pool_base_ta": k(139),
           "pool_quote_ta": k(171), "lp_supply_field": struct.unpack_from("<Q", data, 203)[0]}
    if len(data) > 243:
        out["is_mayhem_mode"] = None if data[243] not in (0, 1) else bool(data[243])
    return out


def canonical_pool(mint: str) -> tuple[str, str]:
    pa = find_program_address([PUMP_POOL_AUTHORITY_SEED, b58decode(mint)], C.PUMP_PROGRAM)[0]
    pool = find_program_address([b"pool", (0).to_bytes(2, "little"), b58decode(pa), b58decode(mint), b58decode(C.WSOL_MINT)],
                                C.PUMP_AMM_PROGRAM)[0]
    return pool, pa


def read_curve(ctx, mint):
    """-> (facts, slot). Raises RpcError on transport failure."""
    pda = pump_bonding_curve(mint)
    res = ctx.rpc.call("getAccountInfo", [pda, {"encoding": "base64", "commitment": "confirmed"}], ttl=0) or {}
    v = res.get("value")
    f = {"curve_address": pda, "found": bool(v), "owner": (v or {}).get("owner"), "as_of": time.time()}
    if v:
        f.update(decode_curve(_b64(v)) or {"decode_error": True})
    return f, (res.get("context") or {}).get("slot")


def read_mint(ctx, mint):
    res = ctx.rpc.call("getAccountInfo", [mint, {"encoding": "jsonParsed", "commitment": "confirmed"}], ttl=0) or {}
    v = res.get("value") or {}
    info = (((v.get("data") or {}).get("parsed") or {}).get("info")) or {} if isinstance(v.get("data"), dict) else {}
    exts = [e.get("extension") for e in (info.get("extensions") or []) if isinstance(e, dict)]   # names only: metadata is hostile
    return {"found": bool(v), "token_program": v.get("owner"), "mint_authority": info.get("mintAuthority"),
            "freeze_authority": info.get("freezeAuthority"), "decimals": info.get("decimals"),
            "supply_raw": int(info["supply"]) if str(info.get("supply", "")).isdigit() else None,
            "extensions": exts, "as_of": time.time()}, (res.get("context") or {}).get("slot")


def read_pool(ctx, mint):
    pool, pa = canonical_pool(mint)
    res = ctx.rpc.call("getMultipleAccounts", [[pool], {"encoding": "base64", "commitment": "confirmed"}], ttl=0) or {}
    v = (res.get("value") or [None])[0]
    f = {"pool_address": pool, "pool_authority": pa, "found": bool(v), "owner": (v or {}).get("owner"), "as_of": time.time()}
    if not v:
        return f, (res.get("context") or {}).get("slot")
    p = decode_pool(_b64(v))
    if not p:
        f["decode_error"] = True
        return f, None
    f.update(p)
    accs = ctx.rpc.call("getMultipleAccounts", [[p["lp_mint"], p["pool_base_ta"], p["pool_quote_ta"]],
                                                {"encoding": "jsonParsed", "commitment": "confirmed"}], ttl=0) or {}
    lp, b, q = (accs.get("value") or [None, None, None])[:3]
    li = (((lp or {}).get("data") or {}).get("parsed") or {}).get("info") or {}
    f["lp_mint_supply"] = int(li["supply"]) if str(li.get("supply", "")).isdigit() else None
    amt = lambda a: int(((((a or {}).get("data") or {}).get("parsed") or {}).get("info") or {}).get("tokenAmount", {}).get("amount") or -1)
    f["pool_base_raw"], f["pool_quote_raw"] = amt(b), amt(q)
    return f, (accs.get("context") or {}).get("slot")


def read_holders(ctx, mint, token_program):
    """All token accounts of the mint via getProgramAccounts. publicnode refuses indexed calls
    ('Indexed requests require a personal token', 2026-11-17) and mainnet-beta 429s getTokenLargestAccounts,
    so this skips publicnode and uses mainnet-beta GPA. -> {owner: raw_balance}"""
    flt = [{"memcmp": {"offset": 0, "bytes": mint}}]
    if token_program == C.TOKEN_PROGRAM:
        flt.insert(0, {"dataSize": 165})
    skip = tuple(e.cfg.name for e in ctx.rpc.eps if e.cfg.name == "publicnode")
    rows = ctx.rpc.call("getProgramAccounts", [token_program, {"encoding": "jsonParsed", "filters": flt, "commitment": "confirmed"}],
                        ttl=0, skip_eps=skip) or []
    bal = {}
    for a in rows:
        try:
            info = a["account"]["data"]["parsed"]["info"]
            amt = int(info["tokenAmount"]["amount"])
        except (KeyError, TypeError, ValueError):
            continue
        if amt > 0:
            bal[info["owner"]] = bal.get(info["owner"], 0) + amt
    return bal, time.time()


def program_owned(ctx, owners):
    """Owners whose account is owned by a program (pool vaults, PDAs) -> excluded from holder concentration.
    publicnode now caps getMultipleAccounts at 10 keys (2026-11-17), so batch by 10."""
    out = {}
    for i in range(0, len(owners), 10):
        chunk = owners[i:i + 10]
        res = ctx.rpc.call("getMultipleAccounts", [chunk, {"encoding": "base64", "dataSlice": {"offset": 0, "length": 0}}], ttl=300) or {}
        for o, a in zip(chunk, res.get("value") or []):
            prog = (a or {}).get("owner")
            if a and prog not in (C.SYSTEM_PROGRAM, None):
                out[o] = prog
    return out


def find_creation_time(ctx, mint, hint_ts=None, max_lookback_s=33 * 3600, resolution_s=20, now=None):
    """Creation time of `mint` from on-chain data only, by bisection: "does the mint have ANY signature before the
    create-stream anchor at time t?" (getSignaturesForAddress(mint, before=anchor(t), limit=1)). Anchors come from the
    pump mint-authority stream index (launches.db), so each probe is one cheap, cacheable call. A DexScreener
    pairCreatedAt hint only narrows the first bracket; it is verified, never trusted.
    Why not the creator's history: create_v2 passes the creator as instruction data, so the create tx is often absent
    from the creator's signatures (seen 2026-11-17). -> {"t_after": ts (<= resolution_s after create), "probes": n,
    "method"} or None (older than the index / free-RPC window, or anchors missing)."""
    now = int(now or time.time())
    probes = [0]

    def has_before(t):
        a = ctx.anchors.anchor_at(int(t), max_pages=0)
        if not a:
            raise LookupError("no stream anchor")
        probes[0] += 1
        return bool(ctx.rpc.get_signatures(mint, 1, before=a["signature"]))

    lo = hi = None
    try:
        if hasattr(ctx.anchors, "ensure_range"):
            ctx.anchors.ensure_range(now - 900, now, max_pages=5)    # keep the index head current (normally 1 page)
        if hint_ts and now - hint_ts < max_lookback_s:
            l, h = int(hint_ts) - 120, min(now - 5, int(hint_ts) + 120)
            if not has_before(l) and has_before(h):
                lo, hi, method = l, h, "bisect(hint-bracket)"
        if lo is None:
            l, h = now - max_lookback_s, now - 5
            if has_before(l):
                return None            # older than the window we can reach for free
            if not has_before(h):
                return {"t_after": now, "probes": probes[0], "method": "newer_than_anchors"}
            lo, hi, method = l, h, "bisect(full)"
        while hi - lo > resolution_s:
            mid = (lo + hi) // 2
            if has_before(mid):
                hi = mid
            else:
                lo = mid
    except LookupError:
        return None
    return {"t_after": hi, "probes": probes[0], "method": method}


def sol_usd(ctx):
    """Median SOL/USD from DexScreener WSOL pairs quoted in USDC/USDT. -> (price|None, as_of)."""
    pairs = ctx.dex.token_pairs(C.WSOL_MINT, ttl=30) or []
    ps = sorted(float(p["priceUsd"]) for p in pairs if (p.get("baseToken") or {}).get("address") == C.WSOL_MINT
                and (p.get("quoteToken") or {}).get("symbol") in ("USDC", "USDT") and p.get("priceUsd"))
    return (ps[len(ps) // 2] if ps else None), time.time()


def dex_market(ctx, mint):
    """DexScreener cross-check only (mcap, liquidity of the best pair). Never authoritative."""
    pairs = ctx.dex.token_pairs(mint, ttl=10) or []
    pairs = [p for p in pairs if p.get("chainId") in (None, "solana")]
    if not pairs:
        return {"found": False, "as_of": time.time()}
    best = max(pairs, key=lambda p: (p.get("liquidity") or {}).get("usd") or 0)
    created = [p.get("pairCreatedAt") for p in pairs if p.get("pairCreatedAt")]
    return {"found": True, "created_hint": (min(created) / 1000) if created else None, "market_cap_usd": best.get("marketCap") or best.get("fdv"), "liquidity_usd": (best.get("liquidity") or {}).get("usd"),
            "dex_id": best.get("dexId"), "pair": best.get("pairAddress"), "as_of": time.time()}


def curve_market(curve: dict, sol_price: float | None) -> dict:
    """Market cap / liquidity from bonding-curve reserves (SOL quote only)."""
    vt, vq = curve.get("virtual_token_reserves") or 0, curve.get("virtual_quote_reserves") or 0
    sup = curve.get("token_total_supply") or C.PUMP_TOTAL_SUPPLY_RAW
    if not vt or not vq or not sol_price:
        return {"market_cap_usd": None, "liquidity_usd": None}
    price_sol_per_raw = (vq / 1e9) / vt
    return {"market_cap_usd": round(price_sol_per_raw * C.PUMP_TOTAL_SUPPLY_RAW * sol_price, 2),
            "liquidity_usd": round(2 * (curve.get("real_quote_reserves") or 0) / 1e9 * sol_price, 2), "supply_raw_used": sup}


def pool_market(pool: dict, sol_price: float | None) -> dict:
    b, q = pool.get("pool_base_raw", -1), pool.get("pool_quote_raw", -1)
    if b is None or q is None or b <= 0 or q <= 0 or not sol_price:
        return {"market_cap_usd": None, "liquidity_usd": None}
    price = (q / 1e9) / b
    return {"market_cap_usd": round(price * C.PUMP_TOTAL_SUPPLY_RAW * sol_price, 2), "liquidity_usd": round(2 * q / 1e9 * sol_price, 2)}
