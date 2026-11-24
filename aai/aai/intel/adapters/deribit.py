"""Deribit public API (keyless): DVOL implied-vol index and option open interest put/call for BTC and ETH."""
from __future__ import annotations
import time
from ..core import FetchError, num

BASE = "https://www.deribit.com/api/v2/public"


def parse_dvol(j) -> dict:
    rows = ((j or {}).get("result") or {}).get("data") or []
    rows = [r for r in rows if isinstance(r, list) and len(r) >= 5 and num(r[4]) is not None]
    if not rows:
        raise FetchError("dvol: no data", retryable=False)
    last = rows[-1]
    day = next((r for r in rows if r[0] >= last[0] - 24 * 3.6e6), rows[0])
    return {"dvol": num(last[4]), "ts": last[0] / 1000, "chg_24h": round(num(last[4]) - num(day[1]), 2),
            "hi_24h": max(num(r[2]) for r in rows if r[0] >= day[0]), "lo_24h": min(num(r[3]) for r in rows if r[0] >= day[0]),
            "spark": [[r[0] / 1000, num(r[4])] for r in rows[-48:]]}


def parse_options(j) -> dict:
    rows = (j or {}).get("result")
    if not isinstance(rows, list) or not rows:
        raise FetchError("option book summary empty", retryable=False)
    put = call = pv = cv = 0.0
    under = None
    for r in rows:
        name, oi = str(r.get("instrument_name") or ""), num(r.get("open_interest")) or 0.0
        vol = num(r.get("volume")) or 0.0
        under = under or num(r.get("underlying_price")) or num(r.get("estimated_delivery_price"))
        if name.endswith("-P"):
            put += oi; pv += vol
        elif name.endswith("-C"):
            call += oi; cv += vol
    return {"put_oi": round(put, 1), "call_oi": round(call, 1), "pc_oi": round(put / call, 3) if call else None,
            "pc_vol_24h": round(pv / cv, 3) if cv else None, "n_instruments": len(rows), "underlying": under}


def fetch(f, cfg, prev=None) -> dict:
    out, errors = {}, {}
    end = int(time.time() * 1000)
    for cur in ("BTC", "ETH"):
        try:
            d = parse_dvol(f.get(f"{BASE}/get_volatility_index_data", params={"currency": cur, "resolution": "3600",
                                                                            "start_timestamp": end - 50 * 3600 * 1000, "end_timestamp": end}))
            o = parse_options(f.get(f"{BASE}/get_book_summary_by_currency", params={"currency": cur, "kind": "option"}, timeout=20))
            out[cur] = {**d, **o}
        except FetchError as e:
            errors[cur] = e.reason
    if not out:
        raise FetchError("deribit: " + "; ".join(f"{k} {v}" for k, v in errors.items())[:200])
    return {"assets": out, "errors": errors}
