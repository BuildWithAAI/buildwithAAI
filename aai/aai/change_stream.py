"""Zoora overview change fingerprint + SSE event stream (paper/read-only).

Replaces blind 5 s polling with server-sent events that push only when the
panel-relevant state actually changes. Alarms still chime client-side on new
alert ids; the change_id just stops redundant re-renders and keeps the link
chip honest (LIVE · SSE vs LIVE · POLL).
"""
from __future__ import annotations

import hashlib
import json
import time
from typing import Iterator


def _round(v, n=4):
    try:
        return round(float(v), n)
    except (TypeError, ValueError):
        return None


def overview_change_id(ov: dict) -> str:
    """Stable short hash of the bits that should refresh the HUD / chime alarms.

    Ignores wall-clock fields (`now`, `uptime_sec`, health cache age) so a quiet
    book does not look like a change every second.
    """
    risk = ov.get("risk") or {}
    guard = ov.get("guard") or {}
    pos = ov.get("positions") or {}
    heavy = ov.get("heavy") or {}
    meta = ov.get("meta") or {}
    hc = meta.get("health_cache") or {}
    bits = {
        "alerts": [(a.get("id"), a.get("sev"), a.get("title")) for a in (ov.get("alerts") or [])],
        "kill": risk.get("kill_switch"),
        "gkill": guard.get("global_kill"),
        "audit_ok": ((ov.get("audit") or {}).get("verify") or {}).get("ok"),
        "pipes": [(p.get("id"), p.get("state"), (p.get("checks") or {}).get("passed"),
                   (p.get("checks") or {}).get("total")) for p in (ov.get("pipelines") or [])],
        "open": [(p.get("id") or p.get("symbol"), p.get("side"), _round(p.get("unrealized") or p.get("upnl"), 2))
                 for p in (pos.get("open") or [])],
        "equity": _round(pos.get("equity"), 2),
        "gauges": [(g.get("id"), _round(g.get("value"), 4)) for g in (risk.get("gauges") or [])],
        "ideas": [(i.get("id") or i.get("symbol"), i.get("sector"), i.get("side") or i.get("recommendation"))
                  for i in (ov.get("ideas") or [])[:12]],
        "econ": [(e.get("id"), e.get("kind"), e.get("sev")) for e in (ov.get("econ_events") or [])],
        "fresh_stale": [(f.get("source"), bool(f.get("stale"))) for f in (ov.get("freshness") or [])],
        "sec_n": len(((ov.get("security") or {}).get("alerts") or [])),
        "memes": [((m.get("symbol") or m.get("mint")), m.get("score"), m.get("recommendation"))
                  for m in ((ov.get("memes") or {}).get("scores") or [])[:8]],
        "heavy_running": bool(heavy.get("running")),
        "hc_src": hc.get("source"),
        "hc_stale": hc.get("stale"),
        "auth": bool(meta.get("auth")),
        "llm": bool((meta.get("llm") or {}).get("present")),
    }
    raw = json.dumps(bits, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def attach_change_id(ov: dict) -> dict:
    """Stamp overview meta.change_id (mutates ov) and return ov."""
    meta = ov.setdefault("meta", {})
    meta["change_id"] = overview_change_id(ov)
    return ov


def format_sse(event: str, data: dict, event_id: str | None = None) -> str:
    """One SSE message (text/event-stream). Data must be a single-line JSON object."""
    parts = []
    if event_id:
        parts.append(f"id: {event_id}")
    parts.append(f"event: {event}")
    parts.append("data: " + json.dumps(data, default=str, separators=(",", ":")))
    return "\n".join(parts) + "\n\n"


def iter_overview_events(zo, *, since: str | None = None, max_sec: float = 90.0,
                         tick_sec: float = 1.0, ping_sec: float = 15.0) -> Iterator[str]:
    """Yield SSE frames for overview changes, then a reconnect hint.

    Read-only: calls `zo.overview()` (cached) and never writes. Caps the stream
    lifetime so a hung client cannot pin a worker forever; EventSource reconnects.
    """
    max_sec = max(2.0, min(120.0, float(max_sec)))
    tick_sec = max(0.05, min(5.0, float(tick_sec)))
    ping_sec = max(2.0, min(60.0, float(ping_sec)))
    deadline = time.time() + max_sec
    last = since or None
    last_ping = 0.0
    sent_any = False
    while time.time() < deadline:
        # Shallow-copy so stamping meta.change_id does not race other overview readers.
        base = zo.overview()
        ov = dict(base)
        ov["meta"] = dict(base.get("meta") or {})
        attach_change_id(ov)
        cid = ov["meta"]["change_id"]
        now = time.time()
        if cid != last:
            last = cid
            sent_any = True
            last_ping = now
            yield format_sse("overview", {"ok": True, **ov}, event_id=cid)
        elif now - last_ping >= ping_sec or not sent_any:
            # Initial ping when `since` already matches: proves the stream is live
            # without a redundant full payload.
            last_ping = now
            sent_any = True
            yield format_sse("ping", {"ts": now, "change_id": last or cid})
        time.sleep(tick_sec)
    yield format_sse("reconnect", {"change_id": last, "reason": "max_sec"})
