"""FRED series through the keyless fredgraph CSV download (one request per series)."""
from __future__ import annotations
import csv, io
from datetime import datetime, timedelta, timezone
from ..core import FetchError, num

URL = "https://fred.stlouisfed.org/graph/fredgraph.csv"
SERIES = [("DFF", "Fed funds (effective)", "%"), ("DGS3MO", "3M T-bill", "%"), ("DGS2", "2Y Treasury", "%"),
          ("DGS10", "10Y Treasury", "%"), ("T10YIE", "10Y breakeven inflation", "%"), ("VIXCLS", "VIX close", ""),
          ("DTWEXBGS", "Broad trade-weighted USD", "idx"), ("BAMLH0A0HYM2", "HY credit spread (OAS)", "%")]


def parse_csv(sid: str, text: str) -> dict:
    obs = []
    for r in csv.DictReader(io.StringIO(text)):
        d, v = r.get("observation_date") or r.get("DATE"), num(r.get(sid))
        if d and v is not None:
            try:
                ts = datetime.strptime(d, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp()
            except ValueError:
                continue
            obs.append([ts, v])
    if not obs:
        raise FetchError(f"{sid}: no observations", retryable=False)
    last, prev = obs[-1], obs[-2] if len(obs) > 1 else None
    wk = next((o for o in reversed(obs) if o[0] <= last[0] - 6 * 86400), None)
    mo = next((o for o in reversed(obs) if o[0] <= last[0] - 28 * 86400), None)
    return {"id": sid, "date": datetime.fromtimestamp(last[0], timezone.utc).strftime("%Y-%m-%d"), "ts": last[0], "value": last[1],
            "chg_1d": None if not prev else round(last[1] - prev[1], 4), "chg_1w": None if not wk else round(last[1] - wk[1], 4),
            "chg_1m": None if not mo else round(last[1] - mo[1], 4), "spark": obs[-60:]}


def fetch(f, cfg, prev=None) -> dict:
    start = (datetime.now(timezone.utc) - timedelta(days=100)).strftime("%Y-%m-%d")
    out, errors = {}, {}
    for sid, label, unit in SERIES:
        try:
            s = parse_csv(sid, f.get(URL, params={"id": sid, "cosd": start}, as_="text", timeout=20, retries=1))
            out[sid] = {**s, "label": label, "unit": unit}
        except FetchError as e:
            errors[sid] = e.reason
    if not out:
        raise FetchError("all FRED series failed: " + "; ".join(f"{k} {v}" for k, v in errors.items())[:200])
    return {"series": out, "errors": errors}
