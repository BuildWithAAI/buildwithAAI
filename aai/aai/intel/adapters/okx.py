"""OKX public v5 (keyless): USDT-swap funding, open interest (USD), mark vs index basis, premium."""
from __future__ import annotations
from ..core import FetchError, num

BASE = "https://www.okx.com/api/v5"


def _d(j):
    if not isinstance(j, dict) or str(j.get("code")) != "0" or not j.get("data"):
        raise FetchError(f"okx code {j.get('code') if isinstance(j, dict) else '?'}")
    return j["data"][0]


def parse_one(base, fr, oi, mk, ix) -> dict:
    f, o, m, i = _d(fr), _d(oi), _d(mk), _d(ix)
    mark, idx, rate = num(m.get("markPx")), num(i.get("idxPx")), num(f.get("fundingRate"))
    prev_t, next_t = num(f.get("prevFundingTime")), num(f.get("fundingTime"))
    ival = round((next_t - prev_t) / 3.6e6) if prev_t and next_t and next_t > prev_t else 8
    o24 = num(i.get("open24h"))
    return {"symbol": base, "venue": "okx", "mark": mark, "index": idx,
            "basis_bp": round((mark - idx) / idx * 1e4, 2) if mark and idx else None,
            "funding": rate, "funding_interval_h": ival, "funding_8h": None if rate is None else rate * 8 / ival,
            "funding_apr": None if rate is None else rate * (24 / ival) * 365, "premium": num(f.get("premium")),
            "next_funding_ts": (next_t or 0) / 1000 or None, "oi_coin": num(o.get("oiCcy")), "oi_usd": num(o.get("oiUsd")),
            "chg_24h": round((idx - o24) / o24, 5) if idx and o24 else None, "ts": (num(m.get("ts")) or 0) / 1000 or None}


def fetch(f, cfg, prev=None) -> dict:
    rows, errors = [], {}
    for base in cfg.get("intel", {}).get("perp_symbols", ["BTC", "ETH", "SOL"]):
        sw = f"{base}-USDT-SWAP"
        try:
            rows.append(parse_one(base, f.get(f"{BASE}/public/funding-rate", params={"instId": sw}, timeout=10),
                                  f.get(f"{BASE}/public/open-interest", params={"instType": "SWAP", "instId": sw}, timeout=10),
                                  f.get(f"{BASE}/public/mark-price", params={"instType": "SWAP", "instId": sw}, timeout=10),
                                  f.get(f"{BASE}/market/index-tickers", params={"instId": f"{base}-USDT"}, timeout=10)))
        except FetchError as e:
            errors[base] = e.reason
    if not rows:
        raise FetchError("okx: " + "; ".join(f"{k} {v}" for k, v in errors.items())[:200])
    return {"rows": rows, "errors": errors}
