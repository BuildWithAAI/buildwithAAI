"""Severity (0-100) + personal relevance (0-1) -> alert tier. Transparent: every score carries reasons."""
from __future__ import annotations
import json, math, re
from datetime import datetime, timedelta
from common.db import INCIDENT_CATS
from common.util import iso, now_utc, parse_time

TIERS = ["CRITICAL", "HIGH", "WATCH", "INFO"]
TIER_RANK = {t: i for i, t in enumerate(TIERS)}
CAT_BASE = {"exchange_hack": 30, "bridge_exploit": 25, "supply_chain": 25, "drainer_phishing": 22, "malware": 22,
            "account_takeover": 20, "defi_exploit": 18, "outage": 15, "vuln_advisory": 15, "rug_pull": 12,
            "regulatory": 8, "exchange_notice": 5, "other": 3}
ACTIONS = {
    "exchange_hack": "Check your exchange balances and open positions; move idle funds you do not need for margin to self-custody; follow only official exchange channels; expect 'refund/compensation' phishing.",
    "bridge_exploit": "Avoid the affected bridge/wrapped assets until a post-mortem is out; check exposure to the bridged token.",
    "defi_exploit": "If you used the protocol: revoke its approvals and withdraw from it; do not interact until a post-mortem is out.",
    "drainer_phishing": "Do not sign blind transactions/permits; check approvals (revoke.cash or Solana delegate check); bookmark official URLs; ignore DMs and 'claim' links.",
    "supply_chain": "Pause using the affected front-end/extension/package; update or remove it; check approvals made during the exposure window.",
    "malware": "Do not install unsigned apps/EAs/extensions; scan trading machine/VPS; rotate exchange API keys from a clean device if you are exposed.",
    "account_takeover": "Confirm SIM-swap lock with your carrier; move 2FA off SMS to passkeys/hardware keys/TOTP.",
    "outage": "Avoid opening new leveraged positions you cannot manage during the outage; keep alternate venue access.",
    "rug_pull": "Treat related tokens as high-risk; run mint checks before buying.",
    "vuln_advisory": "Apply the vendor patch/update; check whether your wallet/app version is affected.",
    "regulatory": "Review whether this affects account access or jurisdiction eligibility.",
    "exchange_notice": "Informational exchange notice; check if it touches assets/networks you use.",
}


def _exposure_index(exposure: dict):
    ents = []
    excl = [re.compile(re.escape(x), re.I) for e in exposure.get("entities", []) for x in e.get("exclude", [])]
    for e in exposure.get("entities", []):
        pats = [re.compile(r"(?<![\w.])" + re.escape(a) + r"(?!\w)", re.I) for a in set(e.get("aliases", []) + [e["name"]])]
        ctx = re.compile(r"\b(" + "|".join(e["context_required"]) + r")", re.I) if e.get("context_required") else None
        ents.append((e["name"], float(e.get("weight", 0.5)), pats, ctx))
    addrs = []
    for kind in ("evm", "solana"):
        for w in (exposure.get("wallets") or {}).get(kind) or []:
            a = w["address"] if isinstance(w, dict) else str(w)
            addrs.append(a.lower() if kind == "evm" else a)
    return ents, addrs, exposure.get("attack_class_boosts", {}), excl


def relevance(item: dict, idx) -> tuple[float, list[str], list[str]]:
    ents, addrs, boosts, excl = idx
    text = " ".join(str(item.get(k) or "") for k in ("title", "summary", "entity", "chain"))
    reasons, matched, best = [], [], 0.0
    title = str(item.get("title") or "")
    summary = " ".join(str(item.get(k) or "") for k in ("summary", "chain"))
    for ex in excl:
        title, summary = ex.sub(" ", title), ex.sub(" ", summary)
    subject = (item.get("entity") or "").lower()
    for name, w, pats, ctx in ents:
        if ctx and not ctx.search(title + " " + summary):
            continue
        if subject and any(p.fullmatch(item.get("entity") or "") for p in pats) or subject == name.lower():
            eff = w                      # the incident is AT your entity
        elif any(p.search(title) for p in pats):
            eff = w * (0.8 if not subject else 0.4)   # mentioned in title; weaker if another entity is the subject
        elif any(p.search(summary) for p in pats):
            eff = w * 0.25               # passing mention in body only
        else:
            continue
        if eff >= 0.5 * w:          # subject or title mention counts as exposure; passing body mention does not
            matched.append(name)
        best = max(best, eff)
    if matched:
        reasons.append(f"mentions your exposure: {', '.join(matched)}")
    low = text.lower()
    if any((a.lower() in low) for a in addrs):
        reasons.append("mentions one of YOUR wallet addresses")
        return 1.0, reasons, matched + ["wallet"]
    cat = item.get("category")
    b = boosts.get(cat, 0.0)
    if cat == "account_takeover" and re.search(r"sim[- ]swap", low):
        b = max(b, boosts.get("sim_swap", 0.0))
    if b:
        reasons.append(f"attack class '{cat}' targets your setup (+{b:.2f})")
    return min(1.0, best + b), reasons, matched


def severity(item: dict, now: datetime, n_sources: int = 1) -> tuple[float, list[str]]:
    reasons = []
    s = CAT_BASE.get(item.get("category") or "other", 3)
    loss = item.get("loss_usd")
    retro = item.get("status") == "retrospective"
    if loss and loss > 1e4:
        ls = min(40.0, 8 * math.log10(loss / 1e4)) * (0.3 if retro else 1.0)
        s += ls
        reasons.append(f"loss ${loss/1e6:,.2f}M (+{ls:.0f})")
    if retro:
        reasons.append("retrospective/follow-up coverage of an older incident (loss weight x0.3, tier capped at WATCH)")
    t = parse_time(item["time_utc"]) or now
    age_d = max(0.0, (now - t).total_seconds() / 86400)
    rec = 20 * math.exp(-age_d / 7)
    s += rec
    if item.get("status") == "active":
        s += 10; reasons.append("appears active/unresolved (+10)")
    elif item.get("status") == "mitigated":
        s -= 8; reasons.append("mitigated/recovery reported (-8)")
    if n_sources > 1:
        c = min(10.0, 2.5 * (n_sources - 1))
        s += c; reasons.append(f"corroborated by {n_sources} sources (+{c:.0f})")
    return max(0.0, min(100.0, s)), reasons


def tier(sev: float, rel: float, cat: str, age_d: float, status: str | None) -> str:
    incident = cat in INCIDENT_CATS
    if status == "retrospective":
        return "WATCH" if rel >= 0.8 and sev >= 30 else "INFO"
    if rel >= 0.8 and sev >= 55 and age_d <= 7 and status != "mitigated" and incident:
        return "CRITICAL"
    if (rel >= 0.6 and sev >= 40 and (incident or cat == "vuln_advisory")) or (sev >= 75 and age_d <= 14):
        return "HIGH"
    if (rel >= 0.4 and sev >= 25) or sev >= 50:
        return "WATCH"
    return "INFO"


def _is_retrospective(items: list[dict], hist) -> bool:
    """News-only cluster that is follow-up coverage of an older incident (laundering updates, forensics,
    explainers, court cases), or whose stated loss matches an incident-DB record >30 days older."""
    from intel.normalize import RETRO, FRESH
    if all(RETRO.search(i["title"] or "") for i in items):
        return True
    for i in items:
        t = parse_time(i["time_utc"])
        recs = hist.get(i["entity_slug"] or "", [])
        if not recs:
            continue
        near = [r for r in recs if r[0] and -10 <= (t - r[0]).days <= 3]
        if near:
            return False
        old = [r for r in recs if r[0] and (t - r[0]).days > 30]
        if old and (RETRO.search(i["title"] or "") or not FRESH.search(i["title"] or "") or (i["loss_usd"] and any(
                r[1] and abs(i["loss_usd"] - r[1]) / r[1] < 0.35 for r in old))):
            return True
    return False


def score_all(con, exposure: dict, lookback_days: int = 120) -> int:
    """Score every item in the lookback window at cluster level and persist per item."""
    now = now_utc()
    idx = _exposure_index(exposure)
    rows = [dict(r) for r in con.execute(
        "SELECT * FROM items WHERE time_utc >= ?", (iso(now - timedelta(days=lookback_days)),))]
    # incident-DB history per entity, to recognise follow-up coverage of OLD incidents
    hist: dict[str, list[tuple[datetime, float | None]]] = {}
    for r in con.execute("SELECT entity_slug, time_utc, loss_usd FROM items WHERE source_type='incident_db' AND entity_slug IS NOT NULL"):
        hist.setdefault(r["entity_slug"], []).append((parse_time(r["time_utc"]), r["loss_usd"]))
    clusters: dict[str, list[dict]] = {}
    for r in rows:
        clusters.setdefault(r["cluster_id"], []).append(r)
    for cid, items in clusters.items():
        srcs = set()
        for it in items:
            srcs |= set(json.loads(it["sources"]))
        loss = max((i["loss_usd"] for i in items if i["loss_usd"]), default=None)
        statuses = {i["status"] for i in items}
        status = "mitigated" if "mitigated" in statuses else "active" if "active" in statuses else None
        if not any(i["source_type"] in ("incident_db", "official") for i in items):
            if _is_retrospective(items, hist):
                status = "retrospective"
                con.executemany("UPDATE items SET status='retrospective' WHERE id=?", [(i["id"],) for i in items])
        rel_best = (0.0, [], [])
        for it in items:
            r = relevance(it, idx)
            if r[0] > rel_best[0]:
                rel_best = r
        for it in items:
            own_matched = relevance(it, idx)[2]
            merged = dict(it, loss_usd=loss or it["loss_usd"], status=status or it["status"])
            sev, sreasons = severity(merged, now, len(srcs))
            age_d = (now - parse_time(it["time_utc"])).total_seconds() / 86400
            tr = tier(sev, rel_best[0], it["category"] or "other", age_d, merged["status"])
            con.execute("UPDATE items SET severity=?, relevance=?, tier=?, reasons=?, matched=? WHERE id=?",
                        (round(sev, 1), round(rel_best[0], 2), tr, json.dumps(sreasons + rel_best[1]),
                         json.dumps(own_matched), it["id"]))
    con.commit()
    return len(rows)
