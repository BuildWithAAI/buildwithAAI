"""alternative.me Crypto Fear & Greed index (keyless, daily)."""
from __future__ import annotations
from ... import guard
from ..core import FetchError, num

URL = "https://api.alternative.me/fng/"


def parse(j) -> dict:
    rows = (j or {}).get("data") if isinstance(j, dict) else None
    if not rows:
        raise FetchError("fear & greed: no data", retryable=False)
    pts = [{"value": num(r.get("value")), "label": guard.clean(r.get("value_classification"), 24), "ts": num(r.get("timestamp"))}
           for r in rows if num(r.get("value")) is not None]
    if not pts:
        raise FetchError("fear & greed: no numeric values", retryable=False)
    cur = pts[0]
    return {"value": cur["value"], "label": cur["label"], "ts": cur["ts"],
            "prev": pts[1]["value"] if len(pts) > 1 else None, "week_ago": pts[7]["value"] if len(pts) > 7 else None,
            "spark": [[p["ts"], p["value"]] for p in pts[:30]][::-1]}


def fetch(f, cfg, prev=None) -> dict:
    return parse(f.get(URL, params={"limit": "30"}))
