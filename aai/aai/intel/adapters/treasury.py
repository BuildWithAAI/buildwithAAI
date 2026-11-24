"""US Treasury daily par yield curve (home.treasury.gov CSV, keyless). Slow endpoint (~15 s), so a long timeout."""
from __future__ import annotations
import csv, io
from datetime import datetime, timezone
from ..core import FetchError, num

URL = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/{y}/all"
PAGE = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve"
TENORS = [("1 Mo", "1M", 1 / 12), ("2 Mo", "2M", 2 / 12), ("3 Mo", "3M", .25), ("4 Mo", "4M", 1 / 3), ("6 Mo", "6M", .5),
          ("1 Yr", "1Y", 1), ("2 Yr", "2Y", 2), ("3 Yr", "3Y", 3), ("5 Yr", "5Y", 5), ("7 Yr", "7Y", 7), ("10 Yr", "10Y", 10),
          ("20 Yr", "20Y", 20), ("30 Yr", "30Y", 30)]


def _rows(text: str) -> list[dict]:
    out = []
    for r in csv.DictReader(io.StringIO(text)):
        try:
            d = datetime.strptime((r.get("Date") or "").strip(), "%m/%d/%Y").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        pts = [{"tenor": lab, "years": yrs, "y": num(r.get(col))} for col, lab, yrs in TENORS]
        out.append({"date": d.strftime("%Y-%m-%d"), "ts": d.timestamp(), "points": [p for p in pts if p["y"] is not None]})
    out.sort(key=lambda x: x["ts"], reverse=True)
    return out


def parse(text: str) -> dict:
    rows = _rows(text)
    if not rows:
        raise FetchError("treasury CSV had no parsable rows", retryable=False)
    cur = rows[0]
    by = {p["tenor"]: p["y"] for p in cur["points"]}

    def prev_val(tenor, back):
        for r in rows[back:back + 1]:
            for p in r["points"]:
                if p["tenor"] == tenor:
                    return p["y"]
        return None

    def spread(a, b, row=0):
        src = rows[row] if row < len(rows) else None
        if not src:
            return None
        m = {p["tenor"]: p["y"] for p in src["points"]}
        return round((m[b] - m[a]) * 100, 1) if m.get(a) is not None and m.get(b) is not None else None
    s2s10, s3m10 = spread("2Y", "10Y"), spread("3M", "10Y")
    wk = min(5, len(rows) - 1)
    return {"as_of": cur["date"], "as_of_ts": cur["ts"], "curve": cur["points"],
            "prev_curve": rows[1]["points"] if len(rows) > 1 else [],
            "y2": by.get("2Y"), "y10": by.get("10Y"), "y3m": by.get("3M"), "y30": by.get("30Y"),
            "d10_bp": round((by["10Y"] - prev_val("10Y", 1)) * 100, 1) if by.get("10Y") is not None and prev_val("10Y", 1) is not None else None,
            "s2s10_bp": s2s10, "s3m10y_bp": s3m10,
            "s2s10_bp_1w": spread("2Y", "10Y", wk), "s3m10y_bp_1w": spread("3M", "10Y", wk),
            "inverted_2s10s": s2s10 is not None and s2s10 < 0, "inverted_3m10y": s3m10 is not None and s3m10 < 0,
            "history_10y": [[r["ts"], next((p["y"] for p in r["points"] if p["tenor"] == "10Y"), None)] for r in rows[:60]][::-1]}


def fetch(f, cfg, prev=None) -> dict:
    y = datetime.now(timezone.utc).year
    params = {"type": "daily_treasury_yield_curve", "field_tdr_date_value": str(y), "page": "", "_format": "csv"}
    text = f.get(URL.format(y=y), params=params, as_="text", timeout=45, retries=1)
    if text.count("\n") < 7:  # early January: add last year's rows so spreads and 1w change exist
        text += "\n" + "\n".join(f.get(URL.format(y=y - 1), params={**params, "field_tdr_date_value": str(y - 1)},
                                       as_="text", timeout=45, retries=1).splitlines()[1:])
    return parse(text)
