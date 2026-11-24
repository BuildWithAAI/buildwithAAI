"""Transparent ranking. Each factor is a value in [0, 1] times a fixed weight,
with a reason string. Total is out of 100.

  loss       25  log10 of the lowest figure from the highest tier that gave one
                 ($10K -> 0, $1B -> 1). Conservative on purpose; figures are
                 never averaged.
  recency    20  age of the freshest source at the end of the run date
                 (<= 24 h -> 1, then linear to 0 at 96 h).
  sources    20  independent publishers weighted by tier (A 1.0, B 0.6, C 0.25),
                 saturating at 2.5.
  novelty    15  new in the fresh window (1.0); recent incident with new
                 coverage (0.6); follow-up to an older incident (0.4); already in
                 a radar run of the last 14 days with new items (0.5) or without
                 (0.1).
  evergreen  10  how directly the incident illustrates an explainer topic.
  audience   10  are retail users affected (target type, mechanism, text cues).
"""

import datetime as dt

from .textutil import day_start, format_usd, iso_z, log_scale

WEIGHTS = {"loss": 25, "recency": 20, "sources": 20, "novelty": 15, "evergreen": 10, "audience": 10}
TIER_WEIGHT = {"A": 1.0, "B": 0.6, "C": 0.25}
TARGET_AUDIENCE = {
    "Wallet": 0.9, "CEX": 0.8, "Crypto Card": 0.7, "Payments": 0.6, "Prediction Market": 0.6,
    "Gambling Platform": 0.5, "Gaming": 0.5, "Token": 0.5, "Chain": 0.5, "Layer 1": 0.5,
    "NFTfi": 0.5, "Web Infrastructure": 0.5, "AI Agent": 0.5, "ICO": 0.5, "Other": 0.4,
    "DeFi Protocol": 0.35, "RWA": 0.35, "Liquidity Pool": 0.3, "DAO": 0.3, "Foundation": 0.3,
    "Mining Infrastructure": 0.2,
}


def _clamp(value, low=0.0, high=1.0):
    return max(low, min(high, value))


def loss_factor(incident):
    losses = incident["reportedLosses"]
    if not losses:
        return 0.0, "no USD figure reported"
    for tier in ("A", "B", "C"):
        tiered = [e for e in losses if e.get("tier") == tier]
        if tiered:
            basis = min(tiered, key=lambda e: e["amountUsd"])
            break
    amounts = [e["amountUsd"] for e in losses]
    publishers = {e["by"] for e in losses}
    value = log_scale(basis["amountUsd"])
    spread = f"{format_usd(min(amounts))}" if min(amounts) == max(amounts) else f"{format_usd(min(amounts))} to {format_usd(max(amounts))}"
    reason = (f"lowest tier-{tier} figure {format_usd(basis['amountUsd'])} ({basis['by']}); "
              f"{len(losses)} figure(s) from {len(publishers)} source(s), range {spread}")
    return value, reason


def recency_factor(members, run_date):
    latest = max(members, key=lambda m: m.fresh)
    end = day_start(run_date) + dt.timedelta(days=1)
    age = max(0.0, (end - latest.fresh).total_seconds() / 3600.0)
    value = _clamp(1.0 - max(0.0, age - 24.0) / 72.0)
    return value, f"freshest source {iso_z(latest.fresh)} ({latest.sid}), {age:.0f} h before the end of {run_date}"


def sources_factor(members):
    publishers = {}
    for m in members:
        weight = TIER_WEIGHT[m.tier]
        if weight > publishers.get(m.publisher, (0, None))[0]:
            publishers[m.publisher] = (weight, m.tier)
    total = sum(w for w, _ in publishers.values())
    by_tier = {}
    for publisher, (_, tier) in sorted(publishers.items()):
        by_tier.setdefault(tier, []).append(publisher)
    parts = [f"{tier}x{len(names)} ({', '.join(names)})" for tier, names in sorted(by_tier.items())]
    return _clamp(total / 2.5), f"{len(publishers)} independent publisher(s): " + "; ".join(parts)


def novelty_factor(incident, previous, run_date, window_start, type_counts):
    date = dt.date.fromisoformat(incident["dateUtc"])
    others = type_counts.get(incident["type"], 0)
    pattern = f"; {others} other {incident['type']} incident(s) in the 14 days before {run_date}"
    if previous:
        urls = {s["url"] for s in incident["sources"]}
        new = urls - previous["urls"]
        where = "top 5" if previous["top"] else "also seen"
        if new:
            return 0.5, f"in the {previous['radarDate']} radar ({where}); {len(new)} new source item(s) since" + pattern
        return 0.1, f"already in the {previous['radarDate']} radar ({where}); no new source items" + pattern
    if date >= window_start:
        return 1.0, "incident date inside the fresh window" + pattern
    age = (run_date - date).days
    if age <= 14:
        return 0.6, f"incident from {date} ({age} days ago), new coverage in the window" + pattern
    return 0.4, f"follow-up to an incident from {date} ({age} days ago)" + pattern


def evergreen_factor(incident, members):
    topic = incident.get("evergreenTopic")
    kind = incident["type"]
    if not topic:
        return 0.0, f"{kind}: no explainer topic fits"
    targets = {m.record.get("targetType") for m in members if m.record and m.record.get("targetType")}
    retail = any(m.retail for m in members)
    if topic in ("address-poisoning", "fake-job-malware", "rug-pulls", "social-engineering") or kind in ("drainer", "phishing"):
        return 1.0, f"{kind} -> {topic} (direct: the incident is the topic)"
    if topic in ("bridge-security", "oracle-manipulation"):
        return 0.7, f"{kind} -> {topic} (direct mechanism, but it is protocol risk rather than a user action)"
    if topic == "drainers":
        return 0.6, f"{kind} -> {topic} (related: approvals or a hijacked front end expose users to drainers)"
    if topic == "key-management":
        if targets & {"Wallet", "CEX"} or retail:
            return 0.7, f"{kind} -> {topic} (custody keys of a user-facing service)"
        return 0.4, f"{kind} -> {topic} (weak: protocol infrastructure key, not a user wallet)"
    return 0.5, f"{kind} -> {topic}"


def audience_factor(incident, members):
    targets = sorted({m.record.get("targetType") for m in members if m.record and m.record.get("targetType")})
    base = max([TARGET_AUDIENCE.get(t, 0.4) for t in targets] or [0.4])
    kind = incident["type"]
    if kind in ("phishing", "drainer", "social-engineering"):
        base = max(base, 0.85)
    elif kind == "rug":
        base = max(base, 0.7)
    retail = sorted({c for m in members for c in m.retail})
    institutional = sorted({c for m in members for c in m.institutional})
    value = _clamp(base + min(0.3, 0.1 * len(retail)) - min(0.2, 0.1 * len(institutional)), 0.05, 1.0)
    parts = [f"target {', '.join(targets) if targets else 'not stated'} (base {base:.2f})"]
    if retail:
        parts.append("retail cues: " + ", ".join(retail[:6]))
    if institutional:
        parts.append("institutional cues: " + ", ".join(institutional[:4]))
    return value, "; ".join(parts)


def score(incident, members, run_date, window_start, previous, type_counts):
    factors = {}
    for name, (value, reason) in (
        ("loss", loss_factor(incident)),
        ("recency", recency_factor(members, run_date)),
        ("sources", sources_factor(members)),
        ("novelty", novelty_factor(incident, previous, run_date, window_start, type_counts)),
        ("evergreen", evergreen_factor(incident, members)),
        ("audience", audience_factor(incident, members)),
    ):
        weight = WEIGHTS[name]
        factors[name] = {
            "value": round(value, 3),
            "weight": weight,
            "points": round(value * weight, 1),
            "reason": reason,
        }
    total = round(sum(f["value"] * f["weight"] for f in factors.values()), 1)
    return {"total": total, "factors": factors}


def analysis_bar(incident, score_doc):
    """Does this incident support a daily Short with real analysis? (owner rule)"""
    missing = []
    if incident["status"] != "confirmed":
        missing.append("not confirmed")
    publishers = {s.get("publisher") for s in incident["sources"]}
    if len(publishers) < 2:
        missing.append("fewer than 2 independent sources")
    if not incident.get("mechanismKnown"):
        missing.append("mechanism not stated by any source")
    if score_doc["factors"]["evergreen"]["value"] < 0.6:
        missing.append("no strong 'one fix' explainer link")
    return {"ready": not missing, "missing": missing}
