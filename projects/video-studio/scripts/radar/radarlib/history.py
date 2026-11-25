"""Previous radar runs: novelty, newly surfaced records, and correction candidates."""

import datetime as dt
import json
import os

from . import classify
from .cluster import Carried, aliases_for, lanes_compatible, names_match, statement_by, url_key


def load_history(directory, run_date, days=14):
    history = {"files": [], "incidents": [], "seenKeys": set()}
    if not directory or not os.path.isdir(directory):
        return history
    for back in range(1, days + 1):
        day = run_date - dt.timedelta(days=back)
        path = os.path.join(directory, f"{day.isoformat()}.json")
        try:
            with open(path, encoding="utf-8") as fh:
                doc = json.load(fh)
        except (OSError, ValueError):
            continue
        if doc.get("mode") != "live" and not doc.get("historyEligible"):
            continue
        history["files"].append(os.path.basename(path))
        history["seenKeys"].update(doc.get("seenRecordKeys", []))
        for group, top in (("top", True), ("alsoSeen", False)):
            for inc in doc.get(group, []):
                history["incidents"].append({
                    "radarDate": day.isoformat(),
                    "top": top,
                    "id": inc.get("id"),
                    "protocol": inc.get("protocol"),
                    "aliases": aliases_for(inc.get("protocol") or ""),
                    # radar files from before the AI lane carry no lane: they held crypto incidents only
                    "lane": inc.get("lane") or "crypto",
                    "dateUtc": inc.get("dateUtc"),
                    "firstSeenUtc": inc.get("firstSeenUtc"),
                    "status": inc.get("status"),
                    "type": inc.get("type"),
                    "losses": {(e.get("by"), url_key(e), round(float(e.get("amountUsd") or 0))) for e in inc.get("reportedLosses", [])},
                    "urls": {url_key(s) for s in inc.get("sources", []) if isinstance(s, dict)},
                    "sources": [s for s in inc.get("sources", []) if isinstance(s, dict) and url_key(s)],
                    "lossEntries": [e for e in inc.get("reportedLosses", []) if isinstance(e, dict) and url_key(e)],
                })
    return history


def type_family(kind):
    """'ai' for an AI type, 'crypto' for a specific crypto mechanism, None for a type that fits either (a generic
    exploit, "other", or none)."""
    if kind in classify.AI_TYPES:
        return "ai"
    if kind in (None, "exploit", "other"):
        return None
    return "crypto"


def families_compatible(a, b):
    fa, fb = type_family(a), type_family(b)
    return fa is None or fb is None or fa == fb


def match_previous(incident, history):
    """Most recent previous radar entry for the same incident, or None. A crypto incident never continues an AI one or
    the reverse: the lanes must be compatible and the types of one family ("DeepSeek" the token rug pull is not
    "DeepSeek" the chatbot's data exposure)."""
    aliases = aliases_for(incident["protocol"])
    when = incident.get("dateUtc") or incident.get("firstSeenUtc")
    if not when:
        return None
    date = dt.date.fromisoformat(when)
    best = None
    for prev in history["incidents"]:
        try:
            prev_date = dt.date.fromisoformat(prev["dateUtc"] or prev.get("firstSeenUtc") or "")
        except (TypeError, ValueError):
            continue
        if abs((prev_date - date).days) > 3 or not names_match(aliases, prev["aliases"]):
            continue
        if not lanes_compatible(incident.get("lane"), prev.get("lane")) or not families_compatible(incident.get("type"), prev.get("type")):
            continue
        if best is None or (prev["radarDate"], prev["top"]) > (best["radarDate"], best["top"]):
            best = prev
    return best


def carried_sources(previous, incident, no_solo=frozenset()):
    """The previous run's sources for this incident that are no longer in today's feeds (feeds keep about a day of
    items): they still count for the status, because a source rotating out of a feed is not a retraction."""
    if not previous:
        return []
    now = {url_key(s) for s in incident["sources"]}
    out = []
    for s in previous.get("sources", []):
        key = url_key(s)
        if key in now:
            continue
        publisher = s.get("publisher") or ""
        tracker = bool(s.get("tracker")) or s.get("id") in ("defillama-hacks", "slowmist-hacked") or s.get("kind") == "structured"
        entry = dict(s)
        entry["carried"] = True
        entry.setdefault("carriedFrom", previous.get("radarDate"))
        # radar files from before the AI lane only held crypto sources
        entry.setdefault("lane", "crypto")
        origin = (s.get("origin") or classify.origin_of(s.get("excerpt") or "", publisher)
                  or classify.origin_of(s.get("title") or "", publisher, headline=True))
        # the project's own statement is read again from the stored text under today's rules (an older file's origin
        # may come from a Title Case or passive headline, which never confirms)
        statement = statement_by(s.get("title") or "", s.get("excerpt") or "", publisher)
        losses = [e for e in previous.get("lossEntries", []) if url_key(e) == key]
        out.append(Carried(sid=s.get("id"), url=key, tier=s.get("tier"), publisher=publisher or s.get("id"),
                           hedge=s.get("hedge"), tracker=tracker, origin=origin, retraction=False,
                           roundup=bool(s.get("roundup")), entry=entry, losses=losses, listed=bool(s.get("listedReport")),
                           statement=statement))
    return out


def corrections(incident, previous):
    """Changes since the previous radar run (candidates for a pinned correction). A status change counts only when it
    survives the carried-over sources (a feed rotating is not a change); a figure change only when the SAME source
    (the same article) now states a different figure. A new source repeating a known figure is not a change."""
    if not previous:
        return []
    changes = []
    if previous["status"] != incident["status"]:
        changes.append(f"status {previous['status']} -> {incident['status']}")
    if previous["type"] != incident["type"]:
        changes.append(f"type {previous['type']} -> {incident['type']}")
    before = {}
    known = set()
    for by, url, amount in previous["losses"]:
        before.setdefault((by, url), set()).add(amount)
        known.add(amount)
    now = {}
    for entry in incident["reportedLosses"]:
        now.setdefault((entry["by"], url_key(entry)), set()).add(round(entry["amountUsd"]))
    for key in sorted(now, key=lambda k: (k[0] or "", k[1] or "")):
        if key not in before:
            # a new article: only a figure nobody stated before is worth a look
            fresh = sorted(a for a in now[key] if not any(abs(a - k) <= 0.05 * max(a, k) for k in known))
            if fresh:
                changes.append(f"new figure from {key[0]}: {', '.join(f'{a:,}' for a in fresh)} USD")
            continue
        added = sorted(now[key] - before[key])
        if added:
            old = ", ".join(f"{a:,}" for a in sorted(before[key]))
            changes.append(f"{key[0]} now states {', '.join(f'{a:,}' for a in added)} USD (previously {old} USD)")
    return changes
