"""Economic calendar: faireconomy.media ForexFactory weekly JSON (keyless). Forecast/previous only; no actuals."""
from __future__ import annotations
import hashlib
from datetime import datetime
from ... import guard
from ..core import FetchError

URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
IMPACT = {"High": 3, "Medium": 2, "Low": 1, "Holiday": 0, "Non-Economic": 0}


def parse(rows) -> dict:
    if not isinstance(rows, list):
        raise FetchError("calendar JSON is not a list", retryable=False)
    ev = []
    for r in rows[:600]:
        if not isinstance(r, dict):
            continue
        try:
            ts = datetime.fromisoformat(str(r.get("date"))).timestamp()
        except ValueError:
            continue
        title, ctry = guard.clean(r.get("title"), 90), guard.clean(r.get("country"), 6).upper()
        imp = str(r.get("impact") or "")
        ev.append({"id": hashlib.sha1(f"{ctry}|{title}|{int(ts)}".encode()).hexdigest()[:12], "ts": ts, "title": title,
                   "country": ctry, "impact": imp if imp in IMPACT else "Low", "rank": IMPACT.get(imp, 1),
                   "forecast": guard.clean(r.get("forecast"), 16) or None, "previous": guard.clean(r.get("previous"), 16) or None})
    if not ev:
        raise FetchError("calendar had no events", retryable=False)
    ev.sort(key=lambda e: e["ts"])
    return {"events": ev, "week_start": ev[0]["ts"], "week_end": ev[-1]["ts"], "n": len(ev),
            "n_high": sum(1 for e in ev if e["rank"] == 3)}


def fetch(f, cfg, prev=None) -> dict:
    return parse(f.get(URL, timeout=15))
