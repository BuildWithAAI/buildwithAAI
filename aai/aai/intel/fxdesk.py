"""T8 Forex desk: a per-pair read-only overlay built only from cached intel payloads (markets quotes, CFTC COT and the
ForexFactory calendar). Pure function, no network, no writes, never an order or a signal. COT positioning is converted
into the pair's direction: for XXXUSD pairs the pair bias follows the XXX futures net, for USDXXX pairs it is flipped.
Positioning is context only (who is crowded), not a trade call. pair_pct_hist carries up to 12 weekly net-%-OI points in
pair terms (oldest first) for the desk's bias sparkline."""
from __future__ import annotations

# pair, base, quote, COT symbol for the non-USD leg, markets symbol (if quoted), sign (+1 if pair long == COT leg long)
PAIRS = [("EURUSD", "EUR", "USD", "EUR", "EURUSD", 1), ("GBPUSD", "GBP", "USD", "GBP", "GBPUSD", 1),
         ("USDJPY", "USD", "JPY", "JPY", "USDJPY", -1), ("AUDUSD", "AUD", "USD", "AUD", "AUDUSD", 1),
         ("USDCAD", "USD", "CAD", "CAD", "USDCAD", -1), ("USDCHF", "USD", "CHF", "CHF", "USDCHF", -1),
         ("XAUUSD", "XAU", "USD", "XAU", "GOLD", 1)]
EXTREME_HI, EXTREME_LO = 90, 10
EVENT_RISK_SEC = 24 * 3600
HIST_WEEKS = 12
_CAL_CCY = {"XAU": "USD"}  # gold has no calendar of its own; USD data is what moves it


def _cot_view(row: dict | None, sign: int) -> dict | None:
    """Bias, flow and the 26-week index all come from the same non-commercial (legacy specs) series so they never
    disagree; leveraged-fund net (TFF) rides along as extra context only."""
    if not row:
        return None
    net, chg, oi = row.get("nc_net"), row.get("nc_net_chg"), row.get("oi")
    pct = round(net / oi * 100, 1) if isinstance(net, (int, float)) and oi else None
    idx = row.get("nc_index_26w")
    pair_idx = None if idx is None else (idx if sign > 0 else 100 - idx)
    pair_pct = None if pct is None else pct * sign
    bias = None if pair_pct is None else ("LONG" if pair_pct > 2 else "SHORT" if pair_pct < -2 else "FLAT")
    extreme = None
    if pair_idx is not None:
        extreme = "26W HIGH" if pair_idx >= EXTREME_HI else "26W LOW" if pair_idx <= EXTREME_LO else None
    lev = row.get("lev_net") if row.get("class") != "commodity" and isinstance(row.get("lev_net"), (int, float)) else None
    hist = []
    for h in row.get("nc_hist") or []:
        if isinstance(h, (list, tuple)) and len(h) >= 3 and isinstance(h[1], (int, float)) and isinstance(h[2], (int, float)) and h[2]:
            hist.append([str(h[0])[:10], round(h[1] / h[2] * 100 * sign, 1)])
    return {"who": "SPEC", "leg": row.get("symbol"), "leg_net": net, "leg_net_chg": chg, "leg_lev_net": lev,
            "pair_lev_net": None if lev is None else lev * sign,
            "pair_net_pct_oi": pair_pct, "pair_index_26w": pair_idx, "bias": bias, "extreme": extreme,
            "flow": None if not isinstance(chg, (int, float)) or chg == 0 else ("TO LONG" if chg * sign > 0 else "TO SHORT"),
            "report_date": row.get("report_date"), "pair_pct_hist": hist[-HIST_WEEKS:],
            "pct_chg_hist": round(hist[-1][1] - hist[0][1], 1) if len(hist) >= 2 else None,
            "flips_12w": flips(hist[-HIST_WEEKS:])}


FLIPS_MAX = 4


def flips(hist: list) -> list[dict]:
    """Weekly zero-crossings of the pair-terms specs bias inside the kept history, newest first (capped). Same rule as
    alarms.fx_bias_flip_alarms: a move from or to exactly 0 is not a flip. Pure: no fetch, no writes."""
    out = []
    for i in range(1, len(hist or [])):
        try:
            (d0, p0), (d1, p1) = hist[i - 1][:2], hist[i][:2]
            p0, p1 = float(p0), float(p1)
        except (TypeError, ValueError):
            continue
        if p0 == 0 or p1 == 0 or (p0 > 0) == (p1 > 0):
            continue
        out.append({"date": str(d1)[:10], "idx": i, "to": "long" if p1 > 0 else "short", "from_pct": p0, "to_pct": p1})
    return out[::-1][:FLIPS_MAX]


def compute(payloads: dict, now: float) -> dict:
    mk = {r.get("symbol"): r for r in ((payloads.get("markets") or {}).get("rows") or []) if isinstance(r, dict)}
    cot_p = payloads.get("cot") or {}
    cot = {r.get("symbol"): r for r in (cot_p.get("rows") or []) if isinstance(r, dict)}
    events = [e for e in ((payloads.get("calendar") or {}).get("events") or []) if isinstance(e, dict)]
    upcoming = sorted((e for e in events if (e.get("ts") or 0) >= now and (e.get("rank") or 0) >= 2), key=lambda e: e["ts"])
    rows = []
    for pair, base, quote, leg, msym, sign in PAIRS:
        ccys = {_CAL_CCY.get(base, base), _CAL_CCY.get(quote, quote)}
        nxt = next((e for e in upcoming if e.get("country") in ccys), None)
        nxt_hi = next((e for e in upcoming if e.get("country") in ccys and e.get("rank") == 3), None)
        q = mk.get(msym) if msym else None
        quote_v = None
        if q and isinstance(q.get("last"), (int, float)):
            quote_v = {"last": q["last"], "chg": q.get("chg"), "chg_20d": q.get("chg_20d"), "ts": q.get("ts")}
        ev = lambda e: None if not e else {"ts": e["ts"], "country": e.get("country"), "title": e.get("title"),
                                            "impact": e.get("impact"), "rank": e.get("rank"), "in_sec": round(e["ts"] - now),
                                            "forecast": e.get("forecast"), "previous": e.get("previous")}
        n_hi_24h = sum(1 for e in upcoming if e.get("country") in ccys and e.get("rank") == 3 and e["ts"] - now <= EVENT_RISK_SEC)
        rows.append({"pair": pair, "base": base, "quote": quote, "quote_px": quote_v, "cot": _cot_view(cot.get(leg), sign),
                     "next_event": ev(nxt), "next_high": ev(nxt_hi), "high_24h": n_hi_24h,
                     "event_risk": n_hi_24h > 0})
    return {"generated_at": now, "rows": rows, "cot_report_date": cot_p.get("report_date"),
            "n_event_risk": sum(1 for r in rows if r["event_risk"]),
            "extremes": [f"{r['pair']} {r['cot']['extreme']}" for r in rows if r["cot"] and r["cot"]["extreme"]],
            "note": "Read-only context from cached feeds. Positioning is not a signal; paper only."}


def text(desk: dict) -> str:
    """Short spoken summary for the 'fx desk' intent."""
    rows = desk.get("rows") or []
    if not rows:
        return "The FX desk has no data yet."
    bits = []
    for r in rows:
        c = r.get("cot")
        s = r["pair"]
        if c and c.get("bias"):
            s += f" specs {c['bias'].lower()}" + (f", positioning at its {c['extreme'][4:].lower()} of 26 weeks" if c.get("extreme") else "")
        if r.get("event_risk") and r.get("next_high"):
            s += f", high-impact {r['next_high']['country']} {r['next_high']['title']} within 24 hours"
        bits.append(s)
    ext = desk.get("extremes") or []
    lead = f"FX desk, COT as of {desk.get('cot_report_date') or 'unknown'}. "
    if ext:
        lead += "At 26-week positioning extremes: " + ", ".join(e.replace("26W ", "").lower() for e in ext) + ". "
    return lead + "; ".join(bits) + "."
