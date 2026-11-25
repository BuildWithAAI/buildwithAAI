"""Transparent ranking. Each factor is a value in [0, 1] times a fixed weight,
with a reason string. Total is out of 100.

  loss       25  log10 of the lowest figure from the highest tier that gave one
                 ($10K -> 0, $1B -> 1). Conservative on purpose; figures are
                 never averaged.
  recency    20  age of the freshest source at the end of the run date
                 (<= 24 h -> 1, then linear to 0 at 96 h). Newsletter round-ups
                 never make an incident look fresh.
  sources    20  independent publishers weighted by tier (A 1.0, B 0.6, C 0.25),
                 saturating at 2.5. Round-ups and listed reports (an incident
                 database's listing of another outlet's article) do not count.
  novelty    15  new in the fresh window (1.0); recent incident with new
                 coverage (0.6); follow-up to an older incident (0.4); already in
                 a radar run of the last 14 days with new items (0.5) or without
                 (0.1).
  evergreen  10  how directly the incident illustrates an explainer topic.
  audience   10  are retail users affected (target type, mechanism, text cues).

AI-security incidents (an AI type, in the "ai" or "both" lane) rarely have a dollar figure, so their "loss" factor is
concrete harm instead (harm_factor): exploited or used in real attacks, users or data affected, a fix, advisory or
takedown shipped, each counted from the best tier that states it, plus corroboration; a reported USD figure still
counts when it is higher. Crypto incidents are scored exactly as before.
"""

import datetime as dt
import re

from .classify import AI_TYPES, _first_unnegated
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


# Concrete harm in an AI-security report: (cue, weight, pattern). A hedged source ("suspected") counts half.
HARM_CUES = (
    ("exploited or used in real attacks", 0.45, re.compile(
        r"\b(?:exploited in the wild|actively exploited|active exploitation|in the wild|used in (?:real )?attacks|"
        r"(?:attackers?|hackers?|threat actors?|actors?|criminals?|scammers?|gangs?)\b[^.;]{0,40}?\b(?:used|exploited|"
        r"abused|breached|compromised|stole|hijacked|targeted|deployed)|(?:breached|compromised|hacked|penetrated|"
        r"hit|targeted)\s+(?:\w+\s+){0,3}?(?:organi[sz]ations|companies|servers|systems|firms|victims|targets|"
        r"universities|agencies|users)|(?:was|were|been) (?:breached|hacked|compromised|penetrated)|campaigns?|"
        r"intrusions?|cyber[- ]?attacks?|stole|stolen|exfiltrated|defrauded|indicted|charged|"
        # passive voice: "a compromised key ... was used by threat actors to access ..."
        r"(?:was|were|been|being|is|are)\s+(?:\w+\s+)?(?:used|exploited|abused|hijacked|weaponi[sz]ed|leveraged|accessed)"
        r"\s+by\s+(?:\w+\s+){0,2}?(?:attackers?|hackers?|threat actors?|criminals?|cybercriminals?|scammers?|gangs?|"
        r"fraudsters?))\b", re.IGNORECASE)),
    ("users or data affected", 0.3, re.compile(
        r"\b(?:\d[\d,.]*\s*(?:million|thousand|k)?\s+(?:distinct\s+|valid\s+|exposed\s+)?(?:users?|customers?|"
        r"people|victims?|organi[sz]ations|companies|repositories|repos|accounts|records|secrets|credentials|keys|"
        r"patients|developers|downloads|installs)|(?:users?|customers?|patients?|victims?|donors?)['’]?\s+(?:\w+\s+)?"
        r"(?:data|information|details|credentials|secrets|chats?|conversations?|keys)|(?:data|secrets|credentials|keys|"
        r"tokens|prompts|chats?|conversations|records|information|names|addresses|emails?|users|customers|patients|"
        r"accounts)\b[^.;]{0,40}?\b(?:were|was|are|is|been|being)\s+(?:exposed|leaked|stolen|spilled|exfiltrated|"
        r"accessed|compromised)|(?:exposed|exposing|leaked|stole|stolen|exfiltrated|spilled|spilling)\s+(?:\w+\s+){0,3}?"
        r"(?:data|information|details|records|secrets|credentials|keys|prompts|chats?|conversations|names|addresses|"
        r"emails?)|exposing|leaked|"
        # a completed access, never an attempt ("gained access to OpenAI API keys", not "attempt to access data")
        r"(?:gained|obtained)\s+(?:unauthori[sz]ed\s+)?access\s+to\s+(?:\w+\s+){0,3}?(?:data|information|secrets|"
        r"credentials|keys|tokens|accounts|records|emails?|files))\b", re.IGNORECASE)),
    ("a fix, advisory or takedown shipped", 0.25, re.compile(
        r"\b(?:patch(?:ed|es)?|fix(?:ed|es)?|hotfix|mitigat(?:ed|ion|ions)|advisory|cve-\d{4}-\d+|security update|"
        r"revok(?:ed|es)|rotat(?:ed|es)|removed|took down|taken down|pulled|disabled|dropped|drops|banned|blocked|"
        r"shut down|restored)\b", re.IGNORECASE)),
)
HARM_TIER = {"A": 1.0, "B": 0.85, "C": 0.4}


def ai_scored(incident):
    """An AI-security incident (an AI type in the ai or both lane): scored on concrete harm, not only on dollars."""
    return incident.get("type") in AI_TYPES and incident.get("lane", "crypto") != "crypto"


def harm_factor(incident, members):
    """Concrete harm for an AI-security incident, so a report without a dollar figure is not buried: each cue counts
    once, at the best tier (A 1.0, B 0.85, C 0.4; a hedged source half) that states it; +0.1 when two or more
    independent publishers state harm. A reported USD figure (the loss factor's rule) wins when it is higher."""
    total, parts, publishers = 0.0, [], set()
    for cue, weight, pattern in HARM_CUES:
        best, who = 0.0, None
        for m in members:
            if m.roundup:
                continue
            text = f"{m.title}. {m.excerpt}"
            if not _first_unnegated(pattern, text):
                continue
            value = HARM_TIER.get(m.tier, 0.4) * (0.5 if m.hedge else 1.0)
            if not m.listed:
                publishers.add(m.publisher)  # a listing repeats another outlet's report: never a second publisher
            if value > best:
                best, who = value, f"{m.publisher}, tier {m.tier}{', hedged' if m.hedge else ''}"
        if best:
            total += weight * best
            parts.append(f"{cue} ({who})")
    if len(publishers) >= 2:
        total += 0.1
        parts.append(f"{len(publishers)} publishers state harm")
    value = min(1.0, total)
    reason = ("AI security, harm instead of a dollar figure: " + "; ".join(parts)) if parts else \
        "AI security: no concrete harm stated yet (no exploitation in the wild, no affected users or data, no fix or advisory)"
    loss_value, loss_reason = loss_factor(incident)
    if loss_value > value:
        return loss_value, loss_reason + "; " + reason
    return value, reason


def recency_factor(members, run_date):
    from .cluster import freshest_member
    latest = freshest_member(members)
    end = day_start(run_date) + dt.timedelta(days=1)
    age = max(0.0, (end - latest.fresh).total_seconds() / 3600.0)
    value = _clamp(1.0 - max(0.0, age - 24.0) / 72.0)
    return value, f"freshest source {iso_z(latest.fresh)} ({latest.sid}), {age:.0f} h before the end of {run_date}"


def sources_factor(members):
    publishers, listed = {}, set()
    for m in members:
        if m.roundup:
            continue  # a weekly round-up repeats other outlets' reports; it is not a source of its own
        if m.listed:
            listed.add(m.publisher)  # an incident database's listing of another outlet's report: discovery only
            continue
        weight = TIER_WEIGHT[m.tier]
        if weight > publishers.get(m.publisher, (0, None))[0]:
            publishers[m.publisher] = (weight, m.tier)
    total = sum(w for w, _ in publishers.values())
    by_tier = {}
    for publisher, (_, tier) in sorted(publishers.items()):
        by_tier.setdefault(tier, []).append(publisher)
    parts = [f"{tier}x{len(names)} ({', '.join(names)})" for tier, names in sorted(by_tier.items())]
    reason = f"{len(publishers)} independent publisher(s): " + "; ".join(parts)
    if listed:
        reason += ("; " if parts else "") + "listed only by " + ", ".join(sorted(listed)) + " (discovery only)"
    return _clamp(total / 2.5), reason


def novelty_factor(incident, previous, run_date, window_start, type_counts):
    date = dt.date.fromisoformat(incident.get("dateUtc") or incident["firstSeenUtc"])
    others = type_counts.get(incident["type"], 0)
    pattern = f"; {others} other {incident['type']} incident(s) in the 14 days before {run_date}"
    if previous:
        urls = {s.get("urlRef") or s.get("url") for s in incident["sources"]}
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
    if topic in ("ai-security", "ai-scams"):
        # what a viewer can do about it: a fake call or a malicious plugin is theirs to spot; a poisoned model is a
        # developer's supply chain
        strength = {"deepfake-fraud": 1.0, "ai-phishing": 1.0, "malicious-ai-tool": 1.0, "prompt-injection": 1.0,
                    "ai-data-exposure": 0.7, "ai-agent-exploit": 0.7, "model-supply-chain": 0.6}.get(kind, 0.5)
        how = "direct: the incident is the topic" if strength == 1.0 else "users of AI tools can act on it" \
            if strength == 0.7 else "related: developers' supply chain" if strength == 0.6 else "related"
        return strength, f"{kind} -> {topic} ({how})"
    if topic == "key-management":
        # A strong "one fix" needs keys a viewer holds or trusts directly: the users' own keys (user-side theft), or
        # the custody keys of a wallet or exchange. A protocol's, bridge's or validator's signing key is not one,
        # whatever "users" cue the text has; institutional cues veto the custody reading.
        institutional = sorted({c for m in members for c in m.institutional})
        if incident.get("userSide"):
            return 0.7, f"{kind} -> {topic} (user-side: the users' own keys or seed phrases)"
        if targets & {"Wallet", "CEX"} and not institutional:
            return 0.7, f"{kind} -> {topic} (custody keys of a user-facing wallet or exchange)"
        why = ("institutional cues: " + ", ".join(institutional[:3])) if institutional else "protocol infrastructure key, not a user wallet"
        return 0.4, f"{kind} -> {topic} (weak: {why})"
    return 0.5, f"{kind} -> {topic}"


# Who an AI-security incident reaches: everyone (scams, phishing, malicious apps), users of AI tools, or companies
AI_AUDIENCE = {
    "deepfake-fraud": 0.85, "ai-phishing": 0.85, "malicious-ai-tool": 0.85, "prompt-injection": 0.6,
    "ai-data-exposure": 0.6, "ai-agent-exploit": 0.6, "ai-washing": 0.5, "model-supply-chain": 0.4,
    "ai-assisted-attack": 0.4,
}


def audience_factor(incident, members):
    targets = sorted({m.record.get("targetType") for m in members if m.record and m.record.get("targetType")})
    base = max([TARGET_AUDIENCE.get(t, 0.4) for t in targets] or [0.4])
    kind = incident["type"]
    if kind in ("phishing", "drainer", "social-engineering"):
        base = max(base, 0.85)
    elif kind == "rug":
        base = max(base, 0.7)
    elif kind in AI_AUDIENCE:
        base = max(base, AI_AUDIENCE[kind])
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
        ("loss", harm_factor(incident, members) if ai_scored(incident) else loss_factor(incident)),
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
    if ai_scored(incident):
        factors["loss"]["basis"] = "harm"  # AI lane: concrete harm, not only a dollar figure
    total = round(sum(f["value"] * f["weight"] for f in factors.values()), 1)
    return {"total": total, "factors": factors}


def sourcing_bar(incident, score_doc):
    """Is this incident sourced well enough to be a daily Short candidate? Confirmed, two independent publishers, a
    mechanism a source states, and a strong "one fix" explainer link. This is NOT the owner's "real analysis" rule:
    the analysis is checked later, by the daily system (scripts/daily) and by the owner on the approval page."""
    missing = []
    if incident["status"] != "confirmed":
        missing.append("not confirmed")
    # independent publishers: never a round-up or an incident database's listing of another outlet's report (a
    # listing is discovery only and never carries a claim), and one article counts once
    publishers, urls = set(), set()
    for s in incident["sources"]:
        if s.get("roundup") or s.get("listedReport"):
            continue
        key = (s.get("urlRef") or s.get("url") or "").rstrip("/").lower()
        if key and key in urls:
            continue
        urls.add(key)
        publishers.add(s.get("publisher"))
    if len(publishers) < 2:
        missing.append("fewer than 2 independent sources")
    if not incident.get("mechanismKnown"):
        missing.append("mechanism not stated by any source")
    if score_doc["factors"]["evergreen"]["value"] < 0.6:
        missing.append("no strong 'one fix' explainer link")
    return {"ready": not missing, "missing": missing}


# Older name, kept so existing callers keep working. The check is about sourcing, not analysis.
analysis_bar = sourcing_bar
