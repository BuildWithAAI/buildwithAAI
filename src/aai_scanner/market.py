"""Documented DEX Screener pools; no inferred trades or fabricated candles."""
from .evidence import measurement, number, ratio, receipt
from .mint import decode_address
from .transport import ProviderError, fetch_json

MARKET_URL = "https://api.dexscreener.com/token-pairs/v1/solana/"
WRAPPED_SOL = "So11111111111111111111111111111111111111112"


class MarketClient:
    def __init__(self, timeout=6):
        self.timeout = timeout

    def pools(self, mint):
        decode_address(mint)
        rows, digest = fetch_json(MARKET_URL + mint, timeout=self.timeout)
        if not isinstance(rows, list) or len(rows) > 1000:
            raise ProviderError("Invalid or oversized market pool collection")
        proof = receipt("DEX Screener", MARKET_URL, "token-pairs/v1/solana",
                        raw_hash=digest, flags=["PROVIDER_TICK_TIME_UNAVAILABLE", "POOL_COVERAGE_NOT_EXHAUSTIVE"])
        pools, seen = [], set()
        for row in rows:
            if not isinstance(row, dict) or row.get("chainId") != "solana":
                continue
            base = row.get("baseToken")
            if not isinstance(base, dict) or base.get("address") != mint:
                # priceUsd belongs to the base asset. Never invert an unverified quote price.
                continue
            address = row.get("pairAddress")
            try:
                decode_address(address)
            except ValueError:
                continue
            if address in seen:
                continue
            seen.add(address)
            liquidity = row.get("liquidity") or {}
            volume = row.get("volume") or {}
            txns = row.get("txns") or {}
            if not all(isinstance(item, dict) for item in (liquidity, volume, txns)):
                raise ProviderError("Invalid market metric shape")
            day = txns.get("h24") or {}
            if not isinstance(day, dict):
                raise ProviderError("Invalid market activity shape")
            def numeric(value, positive=False):
                parsed = number(value, positive=positive)
                return None if parsed is None else format(parsed, "f")
            def count(value):
                return value if type(value) is int and 0 <= value < 10**15 else None
            pools.append({
                "pair": address, "venue": str(row.get("dexId") or "Unknown")[:80],
                "name": str(base.get("name") or "")[:120],
                "symbol": str(base.get("symbol") or "")[:40],
                "price_usd": numeric(row.get("priceUsd"), True),
                "liquidity_usd": numeric(liquidity.get("usd")),
                "volume_24h_usd": numeric(volume.get("h24")),
                "market_cap_usd": numeric(row.get("marketCap")),
                "fdv_usd": numeric(row.get("fdv")),
                "buys_24h": count(day.get("buys")), "sells_24h": count(day.get("sells")),
                "pool_created_at_ms": count(row.get("pairCreatedAt")),
            })
        pools.sort(key=lambda item: number(item["liquidity_usd"]) or 0, reverse=True)
        return pools, proof


def summarize_market(pools, proof, sol_pools, sol_proof):
    selected = next((pool for pool in pools if pool["price_usd"] is not None), None)
    reference = next((pool for pool in sol_pools if pool["price_usd"] is not None), None)
    price = number(selected["price_usd"], True) if selected else None
    sol_price = number(reference["price_usd"], True) if reference else None
    market = {
        "status": "AVAILABLE" if selected else "UNAVAILABLE",
        "name": selected["name"] if selected else None,
        "symbol": selected["symbol"] if selected else None,
        "selected_pool": selected["pair"] if selected else None,
        "selection": "Highest reported USD liquidity among returned base-token pools with a positive price",
        "pools": pools[:50], "reported_pool_count": len(pools),
        "source": proof, "sol_reference_source": sol_proof,
        "classification": "OBSERVED",
        "sol_reference_pool": reference["pair"] if reference else None,
        "price_usd": measurement(format(price, "f") if price is not None else None, proof),
        "sol_price_usd": measurement(format(sol_price, "f") if sol_price is not None else None, sol_proof),
        "price_sol": measurement(ratio(price, sol_price) if price is not None and sol_price is not None else None,
                                 [proof, sol_proof], "DERIVED", flags=[] if proof is sol_proof else ["NON_ATOMIC_PRICE_SNAPSHOTS"]),
    }
    for key in ("liquidity_usd", "volume_24h_usd", "market_cap_usd", "fdv_usd", "buys_24h", "sells_24h"):
        market[key] = measurement(selected[key] if selected else None, proof)
    known = [number(pool["liquidity_usd"]) for pool in pools if pool["liquidity_usd"] is not None]
    total = sum(known) if known else None
    market["largest_reported_pool_liquidity_share_pct"] = measurement(
        ratio(max(known) * 100, total) if total else None, proof, "DERIVED",
        flags=["RETURNED_POOLS_ONLY", "MISSING_POOL_LIQUIDITY_EXCLUDED"])
    return market
