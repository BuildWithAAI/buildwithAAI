"""Previous radar runs: novelty, newly surfaced records, and correction candidates."""

import datetime as dt
import json
import os

from .cluster import aliases_for, names_match


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
                    "dateUtc": inc.get("dateUtc"),
                    "status": inc.get("status"),
                    "type": inc.get("type"),
                    "losses": {(e.get("by"), round(float(e.get("amountUsd") or 0))) for e in inc.get("reportedLosses", [])},
                    "urls": {s.get("url") for s in inc.get("sources", [])},
                })
    return history


def match_previous(incident, history):
    """Most recent previous radar entry for the same incident, or None."""
    aliases = aliases_for(incident["protocol"])
    date = dt.date.fromisoformat(incident["dateUtc"])
    best = None
    for prev in history["incidents"]:
        try:
            prev_date = dt.date.fromisoformat(prev["dateUtc"])
        except (TypeError, ValueError):
            continue
        if abs((prev_date - date).days) > 3 or not names_match(aliases, prev["aliases"]):
            continue
        if best is None or (prev["radarDate"], prev["top"]) > (best["radarDate"], best["top"]):
            best = prev
    return best


def corrections(incident, previous):
    """Changes since the previous radar run (candidates for a pinned correction)."""
    if not previous:
        return []
    changes = []
    if previous["status"] != incident["status"]:
        changes.append(f"status {previous['status']} -> {incident['status']}")
    if previous["type"] != incident["type"]:
        changes.append(f"type {previous['type']} -> {incident['type']}")
    # Items drop out of feeds over time, so a figure that is no longer seen is not a
    # correction. A source that now states a different figure is.
    before = {}
    for by, amount in previous["losses"]:
        before.setdefault(by, set()).add(amount)
    now = {}
    for entry in incident["reportedLosses"]:
        now.setdefault(entry["by"], set()).add(round(entry["amountUsd"]))
    for by in sorted(now):
        added = sorted(now[by] - before.get(by, set()))
        if not added:
            continue
        shown = ", ".join(f"{a:,}" for a in added)
        if by in before:
            old = ", ".join(f"{a:,}" for a in sorted(before[by]))
            changes.append(f"{by} now states {shown} USD (previously {old} USD)")
        else:
            changes.append(f"new figure from {by}: {shown} USD")
    return changes
