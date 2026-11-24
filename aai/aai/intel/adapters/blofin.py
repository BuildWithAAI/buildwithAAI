"""Blofin public perps: funding, open interest, mark vs index (basis) for the majors. Keyless."""
from __future__ import annotations
from ..core import FetchError, num

BASE = "https://openapi.blofin.com/api/v1/market"


def _data(j):
    if not isinstance(j, dict) or str(j.get("code")) != "0" or not j.get("data"):
        raise FetchError(f"blofin code {j.get('code') if isinstance(j, dict) else '?'}", retryable=True)
    return j["data"][0]


def parse_one(sym, fr, oi, mk, tk) -> dict:
    f, o, m, t = _data(fr), _data(oi), _data(mk), _data(tk)
    mark, idx, last = num(m.get("markPrice")), num(m.get("indexPrice")), num(t.get("last"))
    rate, ival = num(f.get("fundingRate")), num(f.get("fundingInterval")) or 8
    oi_coin = num(o.get("openInterestCurrency"))
    o24 = num(t.get("open24h"))
    return {"symbol": sym, "venue": "blofin", "last": last, "mark": mark, "index": idx,
            "basis_bp": round((mark - idx) / idx * 1e4, 2) if mark and idx else None,
            "funding": rate, "funding_interval_h": ival, "funding_8h": None if rate is None else rate * 8 / ival,
            "funding_apr": None if rate is None else rate * (24 / ival) * 365,
            "next_funding_ts": (num(f.get("fundingTime")) or 0) / 1000 or None,
            "oi_coin": oi_coin, "oi_usd": oi_coin * mark if oi_coin and mark else None,
            "chg_24h": round((last - o24) / o24, 5) if last and o24 else None, "vol24h_usd": num(t.get("volCurrency24h")),
            "ts": (num(m.get("ts")) or 0) / 1000 or None}


def fetch(f, cfg, prev=None) -> dict:
    rows, errors = [], {}
    for base in cfg.get("intel", {}).get("perp_symbols", ["BTC", "ETH", "SOL"]):
        sym = f"{base}-USDT"
        try:
            g = lambda p: f.get(f"{BASE}/{p}", params={"instId": sym}, timeout=10)
            rows.append(parse_one(base, g("funding-rate"), g("open-interest"), g("mark-price"), g("tickers")))
        except FetchError as e:
            errors[base] = e.reason
    if not rows:
        raise FetchError("blofin: " + "; ".join(f"{k} {v}" for k, v in errors.items())[:200])
    return {"rows": rows, "errors": errors}
