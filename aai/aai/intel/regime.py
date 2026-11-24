"""Cross-asset regime readout. A transparent HEURISTIC, not a trading signal: every input, rule and score is returned
so the HUD can show exactly how the label was reached. Missing inputs are skipped (never assumed)."""
from __future__ import annotations

DISCLAIMER = "Heuristic summary of public data, not a signal or advice. Paper trading only."


def _rule(name, value, unit, score, rule, src):
    return {"input": name, "value": value, "unit": unit, "score": score, "rule": rule, "source": src}


def compute(p: dict) -> dict:
    """p: feed -> payload (or None). Each rule scores -1 (risk-off), 0 or +1 (risk-on)."""
    rows = []
    mk = {r["symbol"]: r for r in ((p.get("markets") or {}).get("rows") or [])}
    fred = (p.get("fred") or {}).get("series") or {}
    vix = (mk.get("VIX") or {}).get("last") or (fred.get("VIXCLS") or {}).get("value")
    if vix is not None:
        rows.append(_rule("VIX", round(vix, 2), "", 1 if vix < 15 else (-1 if vix > 22 else 0), "<15 on · >22 off", "Yahoo/FRED"))
    rates = p.get("rates") or {}
    if rates.get("s3m10y_bp") is not None:
        v = rates["s3m10y_bp"]
        rows.append(_rule("3m10y curve", v, "bp", -1 if v < 0 else 0, "inverted (<0) off", "US Treasury"))
    if rates.get("d10_bp") is not None:
        v = rates["d10_bp"]
        rows.append(_rule("10Y 1-day change", v, "bp", -1 if v > 10 else 0, ">+10bp off (rates shock)", "US Treasury"))
    hy = (fred.get("BAMLH0A0HYM2") or {})
    if hy.get("value") is not None:
        v, w = hy["value"], hy.get("chg_1m")
        s = -1 if v > 4.5 or (w is not None and w > 0.5) else (1 if v < 3.5 else 0)
        rows.append(_rule("HY credit spread", v, "%", s, "<3.5 on · >4.5 or +50bp/1m off", "FRED ICE BofA"))
    dxy = mk.get("DXY") or {}
    if dxy.get("chg_20d") is not None:
        v = round(dxy["chg_20d"] * 100, 2)
        rows.append(_rule("DXY 20-day", v, "%", -1 if v > 2 else (1 if v < -2 else 0), ">+2% off · <-2% on", "Yahoo"))
    spy = mk.get("SPY") or {}
    if spy.get("chg_20d") is not None:
        v = round(spy["chg_20d"] * 100, 2)
        rows.append(_rule("SPY 20-day", v, "%", 1 if v > 2 else (-1 if v < -3 else 0), ">+2% on · <-3% off", "Yahoo"))
    funds = [r["funding_8h"] for k in ("deriv_blofin", "deriv_okx") for r in ((p.get(k) or {}).get("rows") or [])
             if r.get("symbol") == "BTC" and r.get("funding_8h") is not None]
    if funds:
        v = round(sum(funds) / len(funds) * 100, 4)
        rows.append(_rule("BTC funding (8h avg)", v, "%", 1 if 0 < v <= 0.03 else (-1 if v < 0 else 0),
                          "0-0.03% on · <0 off · >0.03 crowded (0)", "Blofin/OKX"))
    fg = (p.get("fear_greed") or {}).get("value")
    if fg is not None:
        rows.append(_rule("Crypto Fear & Greed", fg, "", 1 if fg >= 60 else (-1 if fg <= 30 else 0), ">=60 on · <=30 off", "alternative.me"))
    st = (p.get("stablecoins") or {}).get("chg_7d_pct")
    if st is not None:
        v = round(st * 100, 2)
        rows.append(_rule("Stablecoin supply 7d", v, "%", 1 if v > 0.5 else (-1 if v < -0.5 else 0), ">+0.5% on · <-0.5% off", "DefiLlama"))
    if len(rows) < 3:
        return {"label": "INSUFFICIENT DATA", "score": None, "n_inputs": len(rows), "rows": rows, "heuristic": True, "disclaimer": DISCLAIMER}
    score = sum(r["score"] for r in rows)
    norm = score / len(rows)
    label = "RISK-ON" if norm >= 0.25 else ("RISK-OFF" if norm <= -0.25 else "NEUTRAL")
    return {"label": label, "score": score, "norm": round(norm, 2), "n_inputs": len(rows), "rows": rows,
            "rule": "mean score >= +0.25 RISK-ON, <= -0.25 RISK-OFF, else NEUTRAL", "heuristic": True, "disclaimer": DISCLAIMER}
