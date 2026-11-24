"""Mentions -> incidents.

1. Every security-relevant item becomes a Mention: sanitised title and excerpt,
   dates, subject, aliases, reported amounts, type vote and flags.
2. Structured records (DefiLlama, SlowMist) form seed clusters: names match and
   incident dates within 2 days.
3. Post-mortems, vendor research and news attach to the best seed: a seed alias
   in the title or excerpt (or matching subjects) plus a compatible date
   (stated incident date within 3 days, or publication 1 day before to 21 days
   after the incident; 30 days for post-mortems; 120 days when the item is a
   follow-up such as a seizure, freeze or laundering report).
4. Remaining incident news with a confident subject clusters by subject and date.
   Everything else is listed as unclustered ("also seen"), never guessed.
"""

import datetime as dt
import difflib
import re

from . import classify, safety
from .textutil import (
    clean_ws, core_name, dates_in_text, day_start, format_usd_exact, norm_name, parse_iso, slugify,
)

TIER_RANK = {"A": 0, "B": 1, "C": 2}
TIER_WEIGHT = {"A": 1.0, "B": 0.6, "C": 0.25}
ALIAS_STOP = {
    "bitcoin", "ethereum", "solana", "bsc", "base", "polygon", "arbitrum", "optimism", "avalanche",
    "tron", "crypto", "defi", "dex", "cex", "bridge", "protocol", "exchange", "wallet", "the",
    "network", "chain", "token", "app", "vault", "lend", "finance", "labs", "users", "supply chain",
    "unknown", "other", "hack", "exploit", "north korea", "dprk", "lazarus",
}
_COMPONENT_WORDS = re.compile(
    r"^(?:\S+\s+){0,3}?(?:bridge|vault|vaults|protocol|exchange|wallet|wallets|lending|market|"
    r"markets|contract|contracts|token|tokens|cross-chain|deployer|treasury|pool|pools|app|"
    r"platform|staking|signing|validator|hot)\b",
    re.IGNORECASE,
)
_POSSESSIVE_OWNER = re.compile(r"\b([A-Z][\w.\-]*(?:\s[A-Z][\w.\-]*){0,2})['’]s\s+([^.;:]{0,60})")
_FORMERLY = re.compile(r"formerly (?:known as )?([A-Z][\w.\-]*(?:\s[A-Z][\w.\-]*){0,2})")
POSTMORTEM_TITLE = re.compile(r"post-?mortem|incident (?:analysis|report)|root cause", re.IGNORECASE)


class Mention:
    __slots__ = (
        "source", "item", "sid", "name", "tier", "publisher", "kind", "title", "excerpt", "lead",
        "url", "published", "event_date", "event_kind", "fresh", "subject", "subject_method",
        "aliases", "amounts", "chains", "type_vote", "hedge", "legal", "price", "retail",
        "institutional", "follow_up", "incident", "security", "redactions", "record",
        "reference_url", "key", "relevance_reason",
    )

    def __init__(self, **kw):
        for slot in self.__slots__:
            setattr(self, slot, kw.get(slot))


def _valid_alias(alias):
    alias = alias.strip()
    if not alias or alias in ALIAS_STOP:
        return False
    return len(alias) >= 3 or any(ch.isdigit() for ch in alias)


def aliases_for(name, description=""):
    out = set()
    if not name:
        return out
    full = norm_name(re.sub(r"\([^)]*\)", " ", name))
    core = core_name(name)
    for candidate in (full, core, full.replace(" ", ""), core.replace(" ", "")):
        if _valid_alias(candidate):
            out.add(candidate)
    for inner in re.findall(r"\(([^)]*)\)", name):
        inner = inner.strip()
        if inner and " " not in inner:
            alias = norm_name(inner)
            if _valid_alias(alias):
                out.add(alias)
    head = (description or "")[:220]
    for match in _POSSESSIVE_OWNER.finditer(head):
        owner, rest = match.group(1), match.group(2)
        owner_norm = norm_name(owner)
        if not _valid_alias(owner_norm):
            continue
        if core and (core in norm_name(rest) or _COMPONENT_WORDS.match(rest) or set(owner_norm.split()) & set(core.split())):
            out.add(owner_norm)
            out.add(core_name(owner))
    for match in _FORMERLY.finditer(head):
        alias = norm_name(match.group(1))
        if _valid_alias(alias):
            out.add(alias)
    return {a for a in out if _valid_alias(a)}


def names_match(a_aliases, b_aliases):
    if not a_aliases or not b_aliases:
        return False
    if a_aliases & b_aliases:
        return True
    for a in a_aliases:
        for b in b_aliases:
            short, long_ = (a, b) if len(a) <= len(b) else (b, a)
            if len(short) >= 4 and re.search(rf"(?<![a-z0-9]){re.escape(short)}(?![a-z0-9])", long_):
                return True
            if len(short) >= 5 and difflib.SequenceMatcher(None, a.replace(" ", ""), b.replace(" ", "")).ratio() >= 0.88:
                return True
    return False


def alias_hit(aliases, title, excerpt):
    """2 if an alias is in the title, 1 if only in the excerpt (case-sensitive there), else 0."""
    title_norm = " " + norm_name(title) + " "
    best = 0
    for alias in aliases:
        if len(alias) < 4 and not any(ch.isdigit() for ch in alias):
            continue
        if f" {alias} " in title_norm:
            return 2
    for alias in aliases:
        if len(alias) < 4:
            continue
        # excerpt: require the alias to appear capitalised as written in the text
        pattern = re.compile(rf"(?<![A-Za-z0-9]){re.escape(alias)}(?![A-Za-z0-9])", re.IGNORECASE)
        for match in pattern.finditer(excerpt or ""):
            if match.group(0)[:1].isupper() or match.group(0)[:1].isdigit():
                best = 1
                break
    return best


# ---------------------------------------------------------------- mentions

def build_mentions(source_results, sources_by_id, run_date, seen_keys=None, has_history=False):
    """Returns (mentions, counts) where counts[sid] = {'relevant': n, 'incident': n, 'excluded': n}."""
    mentions, counts = [], {}
    for sid, result in source_results.items():
        source = sources_by_id[sid]
        stats = counts.setdefault(sid, {"relevant": 0, "incident": 0, "excluded": 0})
        for item in result.get("items", []):
            security, incident, why = classify.relevance(item, source)
            if not security:
                stats["excluded"] += 1
                continue
            mention = _mention(item, source, run_date, seen_keys or set(), has_history, incident, why)
            if mention is None:
                continue
            stats["relevant"] += 1
            stats["incident"] += 1 if incident else 0
            mentions.append(mention)
    return mentions, counts


def _mention(item, source, run_date, seen_keys, has_history, incident, why):
    published = parse_iso(item.get("publishedUtc")) if item.get("publishedUtc") else None
    end_of_run = day_start(run_date) + dt.timedelta(days=1)
    if published and published >= end_of_run:
        return None  # published after the run date: not part of this run
    title, t_flags = safety.sanitize(item.get("title") or "")
    excerpt, e_flags = safety.sanitize(item.get("excerpt") or "")
    lead, _ = safety.sanitize(item.get("lead") or "")
    raw_text = f"{item.get('title') or ''} {item.get('excerpt') or ''}"
    text = f"{title} {excerpt}"
    kind = item.get("kind") or "news"
    record = item.get("record")
    event_date, event_kind = None, None
    if item.get("eventDate"):
        event_date = dt.date.fromisoformat(item["eventDate"])
        event_kind = "structured"
    elif kind in ("news", "blog", "postmortem"):
        ref = (published or end_of_run).date()
        found = dates_in_text(raw_text, ref, max_back_days=150)
        if found:
            event_date, event_kind = max(found), "text"
    if event_date and event_date > run_date:
        return None
    tier = source["tier"]
    if kind == "structured":
        fresh = day_start(event_date)
        if has_history and item.get("key") not in seen_keys and (run_date - event_date).days <= 7:
            fresh = day_start(run_date)  # surfaced since the last radar run
    elif tier == "C" and event_date and published:
        fresh = min(published, day_start(event_date))
    else:
        fresh = published or (day_start(event_date) if event_date else None)
    if fresh is None:
        return None
    subject, method = None, None
    if kind == "structured":
        subject, method = record.get("name"), "structured"
    elif kind == "postmortem" and item.get("subject"):
        subject, method = item["subject"], "post-mortem title"
    elif incident:
        own = {(source.get("publisher") or "").lower(), source["name"].lower()}
        subject, method = classify.extract_subject(item.get("title") or "", exclude=own)
    if subject:
        redacted_subject, n = safety.redact_people(subject)
        if n:
            subject, method = None, None
    aliases = aliases_for(subject, (item.get("lead") or "") if kind == "structured" else "") if subject else set()
    amounts = []
    if kind == "structured" and record and record.get("amount"):
        amounts.append((float(record["amount"]), f"reported loss {format_usd_exact(record['amount'])}", "excerpt"))
    else:
        for value, quote in classify.reported_amounts(title):
            amounts.append((value, quote, "title"))
        for value, quote in classify.reported_amounts(excerpt):
            if all(abs(value - v) > 0.5 for v, _, _ in amounts):
                amounts.append((value, quote, "excerpt"))
    if kind == "structured" and source["parser"] == "defillama_hacks":
        vote = classify.type_from_defillama(record)
        text_vote = classify.type_from_text(item.get("lead") or "")
        if classify.fake_job_signal(raw_text):
            vote = ("social-engineering", "fake-job-malware", "text mentions a fake job or interview")
        elif vote[0] in ("exploit", "other") and text_vote and text_vote[0] not in ("exploit", "bridge"):
            vote = text_vote
    elif kind == "structured":
        vote = classify.type_from_slowmist(record.get("method")) or classify.type_from_text(raw_text)
    else:
        vote = classify.type_from_text(raw_text)
    chains = []
    if record and record.get("chains"):
        chains = [classify.normalize_chain(c) for c in record["chains"]]
    for chain in classify.chains_in_text(raw_text):
        if chain not in chains:
            chains.append(chain)
    hedge_text = lead if kind == "structured" else f"{title}. {lead}"
    return Mention(
        source=source, item=item, sid=source["id"], name=source["name"], tier=tier,
        publisher=source.get("publisher") or source["name"], kind=kind, title=title,
        excerpt=excerpt, lead=lead, url=item.get("url"), published=published,
        event_date=event_date, event_kind=event_kind, fresh=fresh, subject=subject,
        subject_method=method, aliases=aliases, amounts=amounts, chains=chains, type_vote=vote,
        hedge=safety.strong_hedge(hedge_text), legal=safety.legal_terms(text),
        price=safety.price_talk(text), retail=classify.retail_cues(text),
        institutional=classify.institutional_cues(text), follow_up=classify.follow_up(text),
        incident=incident, security=True,
        redactions={"names": t_flags["names"] + e_flags["names"], "code": t_flags["code"] + e_flags["code"]},
        record=record, reference_url=item.get("referenceUrl"), key=item.get("key"),
        relevance_reason=why,
    )


# ---------------------------------------------------------------- clustering

class _UnionFind:
    def __init__(self, n):
        self.parent = list(range(n))

    def find(self, i):
        while self.parent[i] != i:
            self.parent[i] = self.parent[self.parent[i]]
            i = self.parent[i]
        return i

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[max(ra, rb)] = min(ra, rb)


def _amount_close(a, b, tolerance=0.05):
    if not a or not b:
        return False
    return abs(a - b) <= tolerance * max(a, b)


def _structured_match(a, b):
    if abs((a.event_date - b.event_date).days) > 2:
        return False
    if names_match(a.aliases, b.aliases):
        return True
    # same day, near-identical figure, and one name appears in the other's text
    amount_a = a.amounts[0][0] if a.amounts else None
    amount_b = b.amounts[0][0] if b.amounts else None
    if abs((a.event_date - b.event_date).days) <= 1 and _amount_close(amount_a, amount_b):
        return alias_hit(a.aliases, b.title, b.excerpt) > 0 or alias_hit(b.aliases, a.title, a.excerpt) > 0
    return False


def cluster_mentions(mentions):
    """Returns (clusters, unclustered). A cluster is a list of mentions."""
    structured = [m for m in mentions if m.kind == "structured"]
    others = [m for m in mentions if m.kind != "structured"]
    uf = _UnionFind(len(structured))
    for i in range(len(structured)):
        for j in range(i + 1, len(structured)):
            if _structured_match(structured[i], structured[j]):
                uf.union(i, j)
    groups = {}
    for i, m in enumerate(structured):
        groups.setdefault(uf.find(i), []).append(m)
    seeds = list(groups.values())
    seed_info = []
    for seed in seeds:
        aliases = set().union(*(m.aliases for m in seed))
        date = min(m.event_date for m in seed)
        seed_info.append((aliases, date))

    leftovers = []
    for m in others:
        best, best_key = None, None
        for index, (aliases, seed_date) in enumerate(seed_info):
            hit = alias_hit(aliases, m.title, m.excerpt)
            if m.subject and names_match(m.aliases, aliases):
                hit = max(hit, 2)
            if not hit:
                continue
            date_score = _date_score(m, seed_date)
            if date_score == 0:
                continue
            lag = abs(((m.event_date or m.fresh.date()) - seed_date).days)
            key = (hit + date_score, -lag)
            if best_key is None or key > best_key:
                best, best_key = index, key
        if best is None:
            leftovers.append(m)
        else:
            seeds[best].append(m)

    news = [m for m in leftovers if m.incident and m.subject]
    unclustered = [m for m in leftovers if not (m.incident and m.subject)]
    uf = _UnionFind(len(news))
    for i in range(len(news)):
        for j in range(i + 1, len(news)):
            if names_match(news[i].aliases, news[j].aliases) and _news_dates_close(news[i], news[j]):
                uf.union(i, j)
    groups = {}
    for i, m in enumerate(news):
        groups.setdefault(uf.find(i), []).append(m)
    return seeds + list(groups.values()), unclustered


def _date_score(m, seed_date):
    if m.event_kind == "text" and m.event_date and abs((m.event_date - seed_date).days) <= 3:
        return 2
    published = (m.published or m.fresh).date()
    if m.follow_up:
        window = 120
    elif m.kind in ("postmortem", "blog") or m.tier == "A":
        window = 30
    else:
        window = 21
    if seed_date - dt.timedelta(days=1) <= published <= seed_date + dt.timedelta(days=window):
        return 1
    return 0


def _news_dates_close(a, b):
    if a.event_kind == "text" and b.event_kind == "text" and a.event_date and b.event_date:
        return abs((a.event_date - b.event_date).days) <= 3
    pa = (a.published or a.fresh).date()
    pb = (b.published or b.fresh).date()
    return abs((pa - pb).days) <= 4


# ---------------------------------------------------------------- incidents

def _display_name(members):
    votes = {}
    shortest = {}
    preference = {"slowmist_hacked": 0, "rekt_news": 1, "defillama_hacks": 2}
    for m in members:
        if not m.subject:
            continue
        core = core_name(m.subject)
        weight = 2 if m.kind in ("structured", "postmortem") else 1
        votes[core] = votes.get(core, 0) + weight
        rank = (preference.get(m.source["parser"], 3), len(m.subject))
        if core not in shortest or rank < shortest[core][0]:
            shortest[core] = (rank, m.subject)
    if not votes:
        return None, []
    winner = max(votes, key=lambda c: (votes[c], -len(c)))
    name = re.sub(r"\s*\([^)]*\)\s*$", "", shortest[winner][1]).strip() or shortest[winner][1]
    others = sorted({s for c, (_, s) in shortest.items() if c != winner})
    return name, others


def _type_choice(members):
    by_tier = {}
    for m in members:
        if m.type_vote:
            by_tier.setdefault(m.tier, []).append((m.type_vote, m))
    for tier in ("A", "B", "C"):
        votes = by_tier.get(tier)
        if not votes:
            continue
        votes.sort(key=lambda v: classify.TYPE_PRIORITY.index(v[0][0]))
        (kind, topic, evidence), m = votes[0]
        evidence_list = sorted({f"{v[0][0]} ({v[1].sid})" for v in votes})
        return kind, topic, f"{evidence} via {m.sid}; tier-{tier} votes: " + ", ".join(evidence_list)
    return "other", None, "no source states a mechanism"


DEFAULT_TOPIC = {
    "drainer": "drainers", "phishing": "phishing", "rug": "rug-pulls",
    "key-compromise": "key-management", "social-engineering": "social-engineering",
    "bridge": "bridge-security", "oracle": "oracle-manipulation",
}


def _status(members):
    tier_a = [m for m in members if m.tier == "A" and not m.hedge]
    if tier_a:
        ids = sorted({m.sid for m in tier_a})
        return "confirmed", "confirmed: unhedged tier-A source(s): " + ", ".join(ids)
    tier_b = {}
    for m in members:
        if m.tier == "B" and not m.hedge:
            tier_b.setdefault(m.publisher, m.sid)
    if len(tier_b) >= 2:
        return "confirmed", "confirmed: 2+ independent unhedged tier-B outlets: " + ", ".join(sorted(tier_b.values()))
    parts = []
    hedged = sorted({f"{m.sid} ('{m.hedge}')" for m in members if m.hedge and m.tier in ("A", "B")})
    if tier_b:
        parts.append(f"only {len(tier_b)} unhedged tier-B outlet ({', '.join(sorted(tier_b.values()))})")
    else:
        parts.append("no unhedged tier-A or tier-B source")
    if hedged:
        parts.append("hedged: " + ", ".join(hedged))
    if any(m.tier == "C" for m in members):
        parts.append("tier-C sources do not count")
    return "developing", "developing: " + "; ".join(parts)


def _source_entry(m):
    entry = {
        "id": m.sid,
        "url": m.url,
        "title": m.title,
        "excerpt": m.excerpt,
        "publishedUtc": m.item.get("publishedUtc"),
        "tier": m.tier,
        "publisher": m.publisher,
        "kind": m.kind,
    }
    if m.event_date:
        entry["eventDate"] = m.event_date.isoformat()
        entry["eventDateFrom"] = m.event_kind
    if m.reference_url:
        entry["referenceUrl"] = m.reference_url
        entry["referenceNote"] = "link cited by the source; not fetched by the radar"
    if m.hedge:
        entry["hedge"] = m.hedge
    if m.redactions["names"] or m.redactions["code"]:
        entry["redacted"] = dict(m.redactions)
    return entry


def _fact(text, m, quote, field):
    return {"text": text, "sourceId": m.sid, "url": m.url, "quote": quote, "field": field}


def build_facts(members, limit=14):
    facts = []
    ordered = sorted(members, key=lambda m: (TIER_RANK[m.tier], m.kind != "structured", m.fresh))
    for m in ordered:
        if m.kind == "structured" and m.source["parser"] == "defillama_hacks":
            rec = m.record
            if rec.get("amount"):
                exact = format_usd_exact(rec["amount"])
                facts.append(_fact(f"{m.name} lists a loss of {exact}.", m, f"reported loss {exact}", "excerpt"))
            if rec.get("classification") or rec.get("technique"):
                label = f"{rec.get('classification') or 'Unclassified'} / {rec.get('technique') or 'Unknown'}"
                facts.append(_fact(f"{m.name} classifies it as {label}.", m, label, "excerpt"))
            facts.append(_fact(f"{m.name} dates it {m.event_date.isoformat()}.", m, m.event_date.isoformat(), "excerpt"))
            if rec.get("chains"):
                chains = ", ".join(rec["chains"])
                facts.append(_fact(f"{m.name} lists the chains as {chains}.", m, f"chains: {chains}", "excerpt"))
            if rec.get("targetType"):
                facts.append(_fact(f"{m.name} lists the target type as {rec['targetType']}.", m,
                                   f"target: {rec['targetType']}", "excerpt"))
        elif m.kind == "structured":
            rec = m.record
            if rec.get("amount"):
                exact = format_usd_exact(rec["amount"])
                facts.append(_fact(f"{m.name} lists a loss of {exact}.", m, f"reported loss {exact}", "excerpt"))
            if rec.get("method"):
                facts.append(_fact(f"{m.name} lists the attack method as {rec['method']}.", m,
                                   f"attack method: {rec['method']}", "excerpt"))
            facts.append(_fact(f"{m.name} dates it {m.event_date.isoformat()}.", m, m.event_date.isoformat(), "excerpt"))
        else:
            when = (m.published or m.fresh).date().isoformat()
            label = "post-mortem" if m.kind == "postmortem" or POSTMORTEM_TITLE.search(m.title) else "headline"
            facts.append(_fact(f"{m.name} {label}, {when}:", m, m.title, "title"))
            for value, quote, field in m.amounts:
                facts.append(_fact(f"{m.name} states a figure of {format_usd_exact(value)}.", m, quote, field))
    verified = []
    for fact in facts:
        member = next(x for x in members if x.url == fact["url"] and x.sid == fact["sourceId"])
        haystack = member.title if fact["field"] == "title" else member.excerpt
        if fact["quote"] and fact["quote"] in haystack and not safety.check_generated(fact["text"].split(":")[0]):
            if fact not in verified:
                verified.append(fact)
    return verified[:limit]


def build_incident(members, run_date):
    members = sorted(members, key=lambda m: (TIER_RANK[m.tier], m.fresh))
    name, other_names = _display_name(members)
    if not name:
        name = "Unknown subject"
    kind, topic, type_reason = _type_choice(members)
    if any(classify.fake_job_signal(f"{m.title} {m.excerpt}") for m in members if m.tier in ("A", "B")):
        topic = "fake-job-malware"
    topic = topic or DEFAULT_TOPIC.get(kind)
    structured_dates = [m.event_date for m in members if m.event_kind == "structured"]
    text_dates = [m.event_date for m in members if m.event_kind == "text"]
    if structured_dates:
        date = min(structured_dates)
    elif text_dates:
        date = min(text_dates)
    else:
        date = min((m.published or m.fresh).date() for m in members)
    chains = []
    for m in members:
        for chain in m.chains:
            if chain not in chains:
                chains.append(chain)
    losses = []
    for m in members:
        for value, quote, field in m.amounts:
            entry = {"amountUsd": value, "by": m.sid, "url": m.url, "quote": quote, "field": field, "tier": m.tier}
            if not any(e["by"] == entry["by"] and e["url"] == entry["url"] and abs(e["amountUsd"] - value) < 0.5 for e in losses):
                losses.append(entry)
    status, status_reason = _status(members)
    post_mortem = None
    for m in members:
        if m.kind == "postmortem" or (m.kind in ("blog", "news") and POSTMORTEM_TITLE.search(m.title)):
            post_mortem = m.url
            break
    notes = []
    if other_names:
        notes.append("Also reported as: " + ", ".join(other_names) + ".")
    distinct = sorted({round(e["amountUsd"]) for e in losses})
    if len(distinct) > 1:
        notes.append(f"Sources state different figures ({len(distinct)} distinct). Quote each with its source; never average.")
    if status == "developing":
        notes.append("Label as developing. Attribute every line to its source.")
    legal = sorted({t for m in members for t in m.legal})
    if legal:
        notes.append("Legal matter (" + ", ".join(legal[:6]) + "): allegations and filings are not findings; name no individuals.")
    if any(m.price for m in members):
        notes.append("Some source text discusses token prices; do not repeat price talk.")
    if any(m.redactions["names"] for m in members):
        notes.append("Personal names were redacted from source text.")
    if any(m.redactions["code"] for m in members):
        notes.append("Addresses or code identifiers were removed from source text (concept level only).")
    user_side = [m for m in members if m.retail and re.search(r"\busers?\b|\bwallets? (?:lose|lost)\b", m.title, re.I)]
    if user_side and kind in ("other", "exploit"):
        notes.append("A source describes user-side losses: do not imply the named vendor was breached unless a source says so.")
    techniques = sorted({m.record.get("technique") for m in members if m.record and m.record.get("technique")})
    unknown = (kind == "other") or (techniques and all(t == "Unknown" for t in techniques))
    incident = {
        "id": f"{date.isoformat()}-{slugify(name)}",
        "title": f"{name}: {classify.TYPE_LABEL[kind]}",
        "protocol": name,
        "chains": chains,
        "type": kind,
        "dateUtc": date.isoformat(),
        "reportedLosses": losses,
        "status": status,
        "statusReason": status_reason,
        "sources": [_source_entry(m) for m in members],
        "postMortemUrl": post_mortem,
        "evergreenTopic": topic,
        "notes": notes,
        "typeReason": type_reason,
        "mechanismKnown": not unknown,
        "facts": build_facts(members),
    }
    return incident


def unclustered_entry(m):
    return {
        "sourceId": m.sid,
        "tier": m.tier,
        "title": m.title,
        "url": m.url,
        "publishedUtc": m.item.get("publishedUtc"),
        "excerpt": m.excerpt,
        "reason": ("no confident subject in the headline" if m.incident else "security topic, not an incident report"),
    }


def freshest(members):
    return max(m.fresh for m in members)


def clean_join(parts):
    return clean_ws(" ".join(p for p in parts if p))
