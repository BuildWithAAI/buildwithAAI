"""Mentions -> incidents.

1. Every security-relevant item becomes a Mention: sanitised title and excerpt,
   dates, subject, aliases, reported amounts, type vote and flags.
2. Structured records (DefiLlama, SlowMist) form seed clusters: names match and
   incident dates within 2 days.
3. Post-mortems, vendor research and news attach to the best seed: a seed alias
   in the title or excerpt (or matching subjects) plus a compatible date
   (stated incident date within 3 days, or publication 1 day before to 21 days
   after the incident; 30 days for post-mortems; 120 days when the item is a
   follow-up such as a seizure, freeze or laundering report). An item is refused
   (it starts its own incident) when it states an incident date more than 3 days
   from the seed's, when its figure is more than twice as far from the seed's as
   the seed's, or when it says "new", "second", "fresh" or "again" about an
   attack, unless it is a follow-up (seizure, freeze, laundering...).
4. Remaining incident news with a confident subject clusters by subject and date,
   with complete linkage (every pair of items within 4 days), so two incidents a
   week apart never chain into one. Everything else is listed as unclustered
   ("also seen"), never guessed.

Names match on an exact alias or a whole word ("Chainflip" in "Chainflip AMM"). A
near-miss spelling ("Prism" / "Prisma Finance") matches only when chain, date
(2 days) and figure (15%) agree too.
"""

import datetime as dt
import difflib
import re

from . import classify, safety
from .textutil import (
    clean_ws, core_name, dates_in_text, day_start, format_usd_exact, norm_name, parse_iso, slugify, truncate,
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
        "reference_url", "key", "relevance_reason", "surfaces", "tracker", "origin", "new_incident",
        "user_side", "mech_status", "qualifier", "month_bound", "possible", "retraction", "roundup",
        "lane", "ref", "listed",
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


def surfaces_for(name, description=""):
    """Names as written (original case) for matching inside headlines and excerpts:
    the name without parentheticals, its core words, parenthetical tokens, and owners
    named in the description ("Fusionist's Endurance Bridge" -> "Fusionist")."""
    out = set()
    if not name:
        return out
    full = clean_ws(re.sub(r"\([^)]*\)", " ", name))
    out.add(full)
    core = core_name(name)
    if core:
        words = full.split()
        count = len(core.split())
        if len(words) >= count:
            out.add(" ".join(words[:count]))
    for inner in re.findall(r"\(([^)]*)\)", name):
        inner = inner.strip()
        if inner and " " not in inner:
            out.add(inner)
    head = (description or "")[:220]
    for match in _POSSESSIVE_OWNER.finditer(head):
        owner, rest = match.group(1), match.group(2)
        if core and (core in norm_name(rest) or _COMPONENT_WORDS.match(rest)
                     or set(norm_name(owner).split()) & set(core.split())):
            out.add(owner)
    for match in _FORMERLY.finditer(head):
        out.add(match.group(1))
    return {s for s in out if _valid_alias(norm_name(s))}


def names_match(a_aliases, b_aliases):
    """An exact alias, or one name as a whole word inside the other ("chainflip" in "chainflip amm"). Never a
    near-miss spelling on its own: "Prism" is not "Prisma Finance" and "Sonne" is not "Sonnet"."""
    if not a_aliases or not b_aliases:
        return False
    if a_aliases & b_aliases:
        return True
    for a in a_aliases:
        for b in b_aliases:
            short, long_ = (a, b) if len(a) <= len(b) else (b, a)
            if len(short) >= 4 and re.search(rf"(?<![a-z0-9]){re.escape(short)}(?![a-z0-9])", long_):
                return True
    return False


def names_similar(a_aliases, b_aliases):
    """Near-miss spellings ("HyperDrive" / "Hyperdrive Finance"): only ever used together with chain, date and
    figure agreement."""
    for a in a_aliases or ():
        for b in b_aliases or ():
            if min(len(a), len(b)) >= 5 and difflib.SequenceMatcher(None, a.replace(" ", ""), b.replace(" ", "")).ratio() >= 0.88:
                return True
    return False


def _agree(a_chains, b_chains, a_date, b_date, a_figure, b_figure):
    """Chain, date (2 days) and figure (15%) all agree: the bar for matching a near-miss name."""
    if not a_chains or not b_chains or not set(a_chains) & set(b_chains):
        return False
    if a_date is None or b_date is None or abs((a_date - b_date).days) > 2:
        return False
    return bool(a_figure and b_figure and _amount_close(a_figure, b_figure, 0.15))


# An item about a NEW attack on a protocol that already has an older incident ("exploited for $800,000 in a new
# attack", "suspected of new exploit", "drained in second exploit", "hit again").
NEW_INCIDENT_RE = re.compile(
    r"\b(?:new|second|third|another|fresh|latest|separate|renewed|repeat)\s+(?:\w+\s+)?(?:attack|exploit|hack|breach|"
    r"incident|drain|theft|heist|compromise)s?\b|\b(?:hacked|exploited|drained|attacked|breached|hit|struck|targeted)\s+"
    r"(?:\w+\s+)?again\b|\bre-?(?:exploited|hacked|attacked|drained)\b|\bonce again\b",
    re.IGNORECASE,
)
# A source walking back an incident: only then may a confirmed incident go back to developing.
# ("no USER funds were affected" is not one: exchanges say it about real hacks of their own wallets.)
RETRACT_RE = re.compile(
    r"\bfalse alarm\b|\bretract\w*|\bno funds (?:were|was|have been) (?:lost|stolen)\b|"
    r"\b(?:was|were) not (?:hacked|exploited|breached|drained)\b|\bdenie[sd] (?:that )?(?:it was |the |any )?(?:hack|breach|exploit)",
    re.IGNORECASE,
)
# Newsletter round-ups mention many stories in passing: never the freshest source, never an independent one.
ROUNDUP_RE = re.compile(r"/newsletters?/|\bin today's newsletter\b|\band more\b", re.IGNORECASE)
# Dates in text that belong to a follow-up, not to the attack ("transfers resumed by Oct. 28", "a Dec. 1 hearing").
_FOLLOW_UP_DATE = re.compile(
    r"(?:resum\w*|reopen\w*|restor\w*|deadline|until|hearing|scheduled|due|filed|published|updated|as of|since|"
    r"by|before|extend\w* to|report(?:ed)?(?: on)?|announc\w*(?: on)?)\s+(?:on\s+|the\s+)?$",
    re.IGNORECASE,
)
_MONTH_EVENT = re.compile(
    r"\b(January|February|March|April|May|June|July|August|September|October|November|December)(?:['’]s)?\s+"
    r"(?:\d{4}\s+)?(?:hack|exploit|attack|breach|theft|heist|incident|drain|compromise)\b",
    re.IGNORECASE,
)
_MONTHS = {m: i for i, m in enumerate(("january", "february", "march", "april", "may", "june", "july", "august",
                                       "september", "october", "november", "december"), 1)}


def _origin(title, excerpt, source, item, people=None):
    """Who an outlet's item relays (the parser reads it from the full text; else the stored text): an organisation,
    never a person (nor a name the run has seen used for one)."""
    people = people or safety.People()
    for origin in (item.get("origin"), classify.origin_of(f"{title}. {excerpt}", source.get("publisher") or source["name"])):
        if (origin and "named person" not in origin and not safety.redact_people(origin.title())[1]
                and not people.mentioned(origin) and not people.mentioned(origin.title())):
            return origin
    return None


def _event_dates(text, ref):
    """Dates in text that may be the attack's own date: dates governed by follow-up wording are skipped."""
    out = []
    for value, start, _end in dates_in_text(text, ref, max_back_days=150, with_spans=True):
        if _FOLLOW_UP_DATE.search(text[max(0, start - 30): start]):
            continue
        out.append(value)
    return out


def _month_bound(text, ref):
    """'after September hack': the last day of that month, as an upper bound for the incident date."""
    match = _MONTH_EVENT.search(text or "")
    if not match:
        return None
    month = _MONTHS[match.group(1).lower()]
    year = ref.year if month <= ref.month else ref.year - 1
    end = dt.date(year + (month == 12), month % 12 + 1, 1) - dt.timedelta(days=1)
    return end if end <= ref else None


def alias_hit(surfaces, title, excerpt):
    """2 if a name appears in the title, 1 if only in the excerpt, else 0.

    Names are matched exactly as written ("MORE" does not match "and more", "Lighter"
    does not match "a lighter touch"); a case-insensitive match is only used for
    multi-word names, which are distinctive on their own."""
    best = 0
    for surface in surfaces:
        if len(surface) < 4 and not any(ch.isdigit() for ch in surface):
            continue
        flags = re.IGNORECASE if " " in surface.strip() else 0
        pattern = re.compile(rf"(?<![A-Za-z0-9]){re.escape(surface)}(?![A-Za-z0-9])", flags)
        if pattern.search(title or ""):
            return 2
        if pattern.search(excerpt or ""):
            best = 1
    return best


# ---------------------------------------------------------------- mentions

def build_mentions(source_results, sources_by_id, run_date, seen_keys=None, has_history=False):
    """Returns (mentions, counts) where counts[sid] = {'relevant': n, 'incident': n, 'excluded': n}."""
    mentions, counts = [], {}
    # organisations seen in this run (incident-database record names, source names): a lone "<Org> said" is not a
    # surname to redact
    known = set()
    for sid, result in source_results.items():
        source = sources_by_id.get(sid) or {}
        known.update(w.lower() for w in re.findall(r"[A-Za-z][A-Za-z0-9]+", f"{source.get('name') or ''} {source.get('publisher') or ''}"))
        for item in result.get("items", []):
            record = item.get("record") or {}
            if item.get("kind") == "structured" and record.get("name"):
                known.update(w.lower() for w in re.findall(r"[A-Za-z][A-Za-z0-9]+", str(record["name"])))
    # names seen used for a person anywhere in the run (a role word before, a personal pronoun after, a pseudonym
    # cue) are redacted everywhere and never become a subject: "Crypto trader X says his wallet was hacked" makes
    # "Was X hacked?" and "X-linked wallet" personal too, although neither has a cue of its own
    found = []
    for result in source_results.values():
        for item in result.get("items", []):
            for field in ("title", "excerpt", "lead", "qualifier"):
                safety.redact_people(item.get(field) or "", known, found=found)
    people = safety.People(safety.person_tokens(found, known))
    # organisations the run knows by their full names (source names and publishers), for AI subjects
    orgs = {n.lower() for s in sources_by_id.values() for n in (s.get("name"), s.get("publisher")) if n}
    for sid, result in source_results.items():
        source = sources_by_id[sid]
        stats = counts.setdefault(sid, {"relevant": 0, "incident": 0, "excluded": 0})
        for item in result.get("items", []):
            found_lane = classify.assess(item, source)
            if not found_lane["security"]:
                stats["excluded"] += 1
                continue
            incident, why = found_lane["incident"], found_lane["reason"]
            mention = _mention(item, source, run_date, seen_keys or set(), has_history, incident, why, known, people,
                               lane=found_lane["lane"], ai_vote=found_lane["aiVote"], orgs=orgs)
            if mention is None:
                continue
            stats["relevant"] += 1
            stats["incident"] += 1 if incident else 0
            stats.setdefault("lanes", {}).setdefault(mention.lane, 0)
            stats["lanes"][mention.lane] += 1
            mentions.append(mention)
    return mentions, counts


def _mention(item, source, run_date, seen_keys, has_history, incident, why, known=frozenset(), people=None,
             lane="crypto", ai_vote=None, orgs=frozenset()):
    published = parse_iso(item.get("publishedUtc")) if item.get("publishedUtc") else None
    end_of_run = day_start(run_date) + dt.timedelta(days=1)
    if published and published >= end_of_run:
        return None  # published after the run date: not part of this run
    people = people or safety.People()
    title, t_flags = safety.sanitize(item.get("title") or "", known, people)
    excerpt, e_flags = safety.sanitize(item.get("excerpt") or "", known, people)
    lead, _ = safety.sanitize(item.get("lead") or "", known, people)
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
        # dates of follow-up events ("transfers resumed by Oct. 28") are not the attack's date
        found = _event_dates(raw_text, ref)
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
        if lane != "ai":
            subject, method = classify.extract_subject(item.get("title") or "", exclude=own)
        if lane in ("ai", "both") and not subject:
            # AI incidents are about products and companies; a name that could be a person is never used
            subject, method = classify.extract_ai_subject(item.get("title") or "", exclude=own, known=set(known) | set(orgs))
    if subject:
        redacted_subject, n = safety.redact_people(subject, known)
        if n or people.mentioned(subject):
            subject, method = None, None
    lead_for_names = (item.get("lead") or "") if kind == "structured" else ""
    aliases = aliases_for(subject, lead_for_names) if subject else set()
    surfaces = surfaces_for(subject, lead_for_names) if subject else set()
    # reports an incident database groups under one incident ("aiid:1846") belong together
    ref = item.get("incidentRef") if isinstance(item.get("incidentRef"), str) else None
    amounts = []
    if kind == "structured" and record and record.get("amount"):
        amounts.append((float(record["amount"]), f"reported loss {format_usd_exact(record['amount'])}", "excerpt"))
    else:
        # a headline's figure for THIS incident only: "..., months after a $1 million exploit" is another incident
        for value, quote in classify.title_amounts(title):
            amounts.append((value, quote, "title"))
        # Excerpt figures only from tier A/B, and not from sentences about other or
        # possible losses; aggregators' running commentary mixes incidents.
        if tier in ("A", "B"):
            for value, quote in classify.excerpt_amounts(excerpt):
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
    elif lane == "ai":
        vote = ai_vote or classify.ai_type_from_text(raw_text)
    else:
        vote = classify.type_from_text(raw_text)
        if lane == "both":
            vote = classify.ai_lane_vote(vote, ai_vote)
    chains = []
    if record and record.get("chains"):
        chains = [classify.normalize_chain(c) for c in record["chains"]]
    if lane != "ai":  # chains are crypto context; an AI item has none ("Knowledge Base, ..." is not Base)
        for chain in classify.chains_in_text(raw_text):
            if chain not in chains:
                chains.append(chain)
    hedge_text = lead if kind == "structured" else f"{title}. {lead}"
    # what the source says about the mechanism, read by the parser from the FULL text before it was cut to an excerpt
    mech_status, qualifier = item.get("mechanismStatus"), item.get("qualifier")
    if not mech_status:
        mech_status, qualifier = classify.mechanism_qualifier(f"{item.get('title') or ''}. {item.get('excerpt') or ''}")
    if qualifier:
        qualifier = safety.sanitize(truncate(qualifier, 280), known, people)[0]
        if qualifier.endswith(".") and qualifier[:-1] in title:
            qualifier = qualifier[:-1]  # the headline itself, without the full stop added to read it as a sentence
    if kind == "structured" and record and str(record.get("method") or "").strip().lower() in ("unknown", "other", "anomaly"):
        mech_status = "unknown"
        qualifier = qualifier or f"attack method: {record.get('method')}"
    full_text = f"{title}. {excerpt}. {lead}. {qualifier or ''}"
    return Mention(
        source=source, item=item, sid=source["id"], name=source["name"], tier=tier,
        publisher=source.get("publisher") or source["name"], kind=kind, title=title,
        excerpt=excerpt, lead=lead, url=item.get("url"), published=published,
        event_date=event_date, event_kind=event_kind, fresh=fresh, subject=subject,
        subject_method=method, aliases=aliases, surfaces=surfaces, amounts=amounts, chains=chains, type_vote=vote,
        hedge=safety.strong_hedge(hedge_text), legal=safety.legal_terms(text),
        price=safety.price_talk(text), retail=classify.retail_cues(text),
        institutional=classify.institutional_cues(text), follow_up=classify.follow_up(text),
        incident=incident, security=True,
        redactions={"names": t_flags["names"] + e_flags["names"], "code": t_flags["code"] + e_flags["code"]},
        record=record, reference_url=item.get("referenceUrl"), key=item.get("key"),
        relevance_reason=why, tracker=bool(source.get("tracker")),
        origin=_origin(title, excerpt, source, item, people) if tier in ("B", "C") else None,
        new_incident=bool(NEW_INCIDENT_RE.search(f"{title} {lead}")),
        user_side=classify.user_side(full_text), mech_status=mech_status, qualifier=qualifier,
        month_bound=_month_bound(raw_text, (published or end_of_run).date()) if kind != "structured" else None,
        possible=classify.includes_possible_losses(f"{title}. {excerpt}"),
        retraction=bool(RETRACT_RE.search(f"{title}. {excerpt}")),
        roundup=bool(ROUNDUP_RE.search(item.get("url") or "") or ROUNDUP_RE.search(title)),
        lane=lane or "crypto", ref=ref, listed=bool(item.get("listedReport")),
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
    amount_a = a.amounts[0][0] if a.amounts else None
    amount_b = b.amounts[0][0] if b.amounts else None
    if names_match(a.aliases, b.aliases):
        return True
    # a near-miss name only with chain, date and figure agreement ("Sonne" and "Sonnet" a day apart are two incidents)
    if names_similar(a.aliases, b.aliases) and _agree(a.chains, b.chains, a.event_date, b.event_date, amount_a, amount_b):
        return True
    # same day, near-identical figure, and one name appears in the other's text
    if abs((a.event_date - b.event_date).days) <= 1 and _amount_close(amount_a, amount_b):
        return alias_hit(a.surfaces, b.title, b.excerpt) > 0 or alias_hit(b.surfaces, a.title, a.excerpt) > 0
    return False


def _refuses_seed(m, seed_date, figures):
    """Reasons a news item must not join an older seed: it is about a different (newer) incident."""
    if m.follow_up:
        return None  # seizures, freezes, laundering and bounties are about the old incident
    if m.new_incident:
        # "a new attack" is newer than SOME earlier incident: refuse only a seed older than the item's own incident
        ref = m.event_date or (m.published.date() if m.published else None)
        if ref is None or (ref - seed_date).days > 3:
            return "the item reports a new or repeat attack, later than this record"
    if m.event_kind == "text" and m.event_date and abs((m.event_date - seed_date).days) > 3:
        return f"the item dates its incident {m.event_date}, more than 3 days from {seed_date}"
    if _figure_score(m, figures) < 0:
        return "the item's figure differs from the seed's by more than 2x"
    return None


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
        surfaces = set().union(*(m.surfaces for m in seed))
        date = min(m.event_date for m in seed)
        figures = [m.amounts[0][0] for m in seed if m.amounts]
        chains = sorted({c for m in seed for c in m.chains})
        seed_info.append((aliases, surfaces, date, figures, chains))

    leftovers = []
    for m in others:
        if m.lane == "ai":
            # the seeds are crypto incident databases: an AI-only item never joins one ("National Cyber Security
            # Centre" in an AI story is not the Cyber Bridge hack)
            leftovers.append(m)
            continue
        best, best_key = None, None
        for index, (aliases, surfaces, seed_date, figures, chains) in enumerate(seed_info):
            hit = alias_hit(surfaces, m.title, m.excerpt)
            if m.subject and names_match(m.aliases, aliases):
                hit = max(hit, 2)
            elif m.subject and names_similar(m.aliases, aliases) and _agree(
                    m.chains, chains, m.event_date or (m.published or m.fresh).date(), seed_date,
                    m.amounts[0][0] if m.amounts else None, figures[0] if figures else None):
                hit = max(hit, 1)
            if not hit:
                continue
            date_score = _date_score(m, seed_date)
            if date_score == 0 or _refuses_seed(m, seed_date, figures):
                continue
            lag = abs(((m.event_date or m.fresh.date()) - seed_date).days)
            key = (hit + date_score + _figure_score(m, figures), -lag)
            if best_key is None or key > best_key:
                best, best_key = index, key
        if best is None:
            leftovers.append(m)
        else:
            seeds[best].append(m)

    news = [m for m in leftovers if m.incident and m.subject]
    rest = [m for m in leftovers if not (m.incident and m.subject)]
    # complete linkage: an item joins a cluster only when it matches EVERY member (name and date), so items a few
    # days apart can never chain two incidents a week apart into one
    news_clusters = []
    for m in sorted(news, key=lambda x: (_item_date(x), x.url or "")):
        target = None
        for members in news_clusters:
            if all(_same_name(m, x) and _news_dates_close(m, x) for x in members) and not (
                    m.new_incident and min(_item_date(x) for x in members) < _item_date(m) - dt.timedelta(days=1)):
                target = members
                break
        if target is None:
            news_clusters.append([m])
        else:
            target.append(m)
    # Items without a confident subject join a news cluster when one of its names
    # is in their title or excerpt and the dates are close; otherwise they stay
    # unclustered ("also seen").
    unclustered = []
    for m in rest:
        best, best_key = None, None
        for index, members in enumerate(news_clusters):
            surfaces = set().union(*(x.surfaces for x in members))
            hit = alias_hit(surfaces, m.title, m.excerpt)
            if m.ref and any(x.ref == m.ref for x in members):
                hit = max(hit, 2)  # the incident database files both reports under one incident
            if not hit or not all(_news_dates_close(m, x) for x in members):
                continue
            key = (hit, len(members))
            if best_key is None or key > best_key:
                best, best_key = index, key
        if best is None:
            unclustered.append(m)
        else:
            news_clusters[best].append(m)
    return seeds + news_clusters, unclustered


def _same_name(a, b):
    """Two news items name the same subject, or an incident database files them under one incident."""
    return names_match(a.aliases, b.aliases) or bool(a.ref and a.ref == b.ref)


def _item_date(m):
    return m.event_date if m.event_kind == "text" and m.event_date else (m.published or m.fresh).date()


def _figure_score(m, figures):
    """+1 when the item's figure is within 15% of a structured figure for the seed,
    -1 when every figure differs by more than 2x (likely a different incident)."""
    if not m.amounts or not figures:
        return 0
    values = [v for v, _, _ in m.amounts]
    if any(_amount_close(v, f, 0.15) for v in values for f in figures):
        return 1
    if all(max(v, f) / max(min(v, f), 1.0) > 2.0 for v in values for f in figures):
        return -1
    return 0


def _date_score(m, seed_date):
    if m.event_kind == "text" and m.event_date and abs((m.event_date - seed_date).days) <= 3:
        return 2
    published = (m.published or m.fresh).date()
    if m.follow_up or m.tier == "C":
        # follow-ups run for months; aggregator timestamps can be catch-up times
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
    """(kind, topic, reason, generic): generic is True when every vote for the chosen type rests on a bare incident
    word ("hack", "theft"), which states no mechanism."""
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
        same = [v for v in votes if v[0][0] == kind]
        generic = all(classify.GENERIC_VOTE.match(v[0][2] or "") for v in same)
        return kind, topic, f"{evidence} via {m.sid}; tier-{tier} votes: " + ", ".join(evidence_list), generic
    return "other", None, "no source states a mechanism", True


DEFAULT_TOPIC = {
    "drainer": "drainers", "phishing": "phishing", "rug": "rug-pulls",
    "key-compromise": "key-management", "social-engineering": "social-engineering",
    "bridge": "bridge-security", "oracle": "oracle-manipulation",
    # the AI lane's explainers (channel.json evergreen): agents, prompt injection and malicious tools; AI-made scams
    "prompt-injection": "ai-security", "ai-agent-exploit": "ai-security", "malicious-ai-tool": "ai-security",
    "model-supply-chain": "ai-security", "ai-data-exposure": "ai-security", "deepfake-fraud": "ai-scams",
    "ai-phishing": "ai-scams",
}


def incident_lane(members):
    """crypto, ai or both: the lanes the incident's sources put it in."""
    lanes = {m.lane or "crypto" for m in members}
    crypto = bool(lanes & {"crypto", "both"})
    ai = bool(lanes & {"ai", "both"})
    return "both" if crypto and ai else "ai" if ai else "crypto"


class Carried:
    """A source a previous live radar run saw for this incident that has since dropped out of its feed. It still
    counts for the status: a feed rotating is not a retraction."""
    __slots__ = ("sid", "url", "tier", "publisher", "hedge", "tracker", "origin", "retraction", "roundup", "entry", "losses")

    def __init__(self, **kw):
        for slot in self.__slots__:
            setattr(self, slot, kw.get(slot))


def _status(members, carried=(), aliases=()):
    """Confirmed needs a primary statement (the project's own report, a post-mortem, a security firm's research or a
    law-enforcement release: an unhedged tier-A source that is not an incident database), or two unhedged tier-B
    outlets that do not relay the same origin. Incident databases (DefiLlama, SlowMist) seed, date and size an
    incident but never confirm it alone. Tier C never counts."""
    pool = [m for m in list(members) + list(carried) if not getattr(m, "roundup", False)]
    walked_back = sorted({m.sid for m in pool if getattr(m, "retraction", False) and m.tier in ("A", "B")})
    if walked_back:
        return "developing", ("developing: " + ", ".join(walked_back) + " walks the report back (a denial, a retraction "
                              "or a false alarm); recheck every claim before any coverage")
    primary = sorted({m.sid for m in pool if m.tier == "A" and not m.tracker and not m.hedge})
    if primary:
        return "confirmed", "confirmed: unhedged primary statement, post-mortem or security-firm research: " + ", ".join(primary)
    own = {a for a in aliases if a}
    relayed = sorted({m.sid for m in pool if m.tier == "B" and not m.hedge and m.origin and (m.origin in own or any(
        re.search(rf"(?<![a-z0-9]){re.escape(a)}(?![a-z0-9])", m.origin) for a in own))})
    # one vote per outlet (two articles from one outlet are one source), keyed by what the outlet relays
    per_outlet = {}
    for m in pool:
        if m.tier == "B" and not m.hedge:
            per_outlet.setdefault((m.publisher or m.sid or "").lower(), m)
    origins = {}
    for publisher, m in per_outlet.items():
        origins.setdefault(m.origin or publisher, m.sid)
    if relayed:
        return "confirmed", "confirmed: the project's own statement, relayed unhedged by " + ", ".join(relayed)
    if len(origins) >= 2:
        return "confirmed", "confirmed: 2+ unhedged tier-B outlets with different origins: " + ", ".join(sorted(origins.values()))
    parts = []
    hedged = sorted({f"{m.sid} ('{m.hedge}')" for m in pool if m.hedge and m.tier in ("A", "B")})
    trackers = sorted({m.sid for m in pool if m.tracker})
    b_unhedged = [m for m in pool if m.tier == "B" and not m.hedge]
    if len(b_unhedged) >= 2 and len(origins) < 2:
        shared = sorted({m.origin for m in b_unhedged if m.origin})
        parts.append("the unhedged tier-B outlets relay one origin" + (f" ({', '.join(shared)})" if shared else ""))
    elif origins:
        parts.append(f"only {len(origins)} unhedged tier-B outlet ({', '.join(sorted(origins.values()))})")
    else:
        parts.append("no unhedged primary statement or tier-B outlet")
    if trackers:
        parts.append("incident databases (" + ", ".join(trackers) + ") seed and size an incident but never confirm it alone")
    if hedged:
        parts.append("hedged: " + ", ".join(hedged))
    if any(m.tier == "C" for m in pool):
        parts.append("tier-C sources do not count")
    return "developing", "developing: " + "; ".join(parts)


def _mechanism(members, kind, generic):
    """('stated' | 'suspected' | 'unknown', the member whose words qualify it or None)."""
    if kind == "other" or generic:
        return "unknown", None
    quals = [m for m in members if m.tier in ("A", "B") and m.mech_status in ("unknown", "suspected")]
    stated_by_primary = any(m.tier == "A" and not m.tracker and not m.hedge and m.mech_status not in ("unknown", "suspected")
                            and m.type_vote and not classify.GENERIC_VOTE.match(m.type_vote[2] or "") for m in members)
    if quals and not stated_by_primary:
        unknown = [m for m in quals if m.mech_status == "unknown"]
        pick = (unknown or quals)[0]
        return ("unknown" if unknown else "suspected"), pick
    return "stated", None


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
    if m.tracker:
        entry["tracker"] = True
    if m.event_date:
        entry["eventDate"] = m.event_date.isoformat()
        entry["eventDateFrom"] = m.event_kind
    if m.reference_url:
        entry["referenceUrl"] = m.reference_url
        entry["referenceNote"] = "link cited by the source; not fetched by the radar"
        if m.tracker and re.search(r"^https?://(?:www\.|mobile\.)?(?:x|twitter)\.com/", m.reference_url, re.IGNORECASE):
            entry["unverified"] = True
            entry["unverifiedReason"] = "the record's only reference is an X post, which the radar cannot read"
    if m.hedge:
        entry["hedge"] = m.hedge
    if m.qualifier and m.mech_status in ("unknown", "suspected"):
        entry["mechanismStatus"] = m.mech_status
        # the caveat sentence, kept as its own short excerpt when it is past the stored title and excerpt
        if m.qualifier not in (m.title or "") and m.qualifier not in (m.excerpt or ""):
            entry["qualifier"] = m.qualifier
    if m.origin:
        entry["origin"] = m.origin
    if m.roundup:
        entry["roundup"] = True
    entry["lane"] = m.lane or "crypto"
    if m.listed:
        # the title, excerpt and link are another outlet's report, listed by an incident database: discovery only
        entry["listedReport"] = True
        if m.item.get("trackerUrl"):
            entry["trackerUrl"] = m.item["trackerUrl"]
        entry["listedNote"] = (f"listed by {m.publisher}; the link is the original report, which the radar did not "
                               "read: take facts from it, never from the listing")
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
        elif m.listed:
            # an incident database's listing of another outlet's report: it says that the report exists, nothing more
            when = (m.published or m.fresh).date().isoformat()
            facts.append(_fact(f"{m.name} lists a report (discovery only), {when}:", m, m.title, "title"))
            continue
        else:
            when = (m.published or m.fresh).date().isoformat()
            label = "post-mortem" if m.kind == "postmortem" or POSTMORTEM_TITLE.search(m.title) else "headline"
            facts.append(_fact(f"{m.name} {label}, {when}:", m, m.title, "title"))
            for value, quote, field in m.amounts:
                qual = classify.qualifier_of(quote)
                facts.append(_fact(f"{m.name} states a figure of {qual + ' ' if qual else ''}{format_usd_exact(value)}.", m, quote, field))
        if m.qualifier and m.mech_status in ("unknown", "suspected"):
            word = "leaves the mechanism unknown" if m.mech_status == "unknown" else "only suspects the mechanism"
            field = "title" if m.qualifier in (m.title or "") else "excerpt" if m.qualifier in (m.excerpt or "") else "qualifier"
            facts.append(_fact(f"{m.name} {word}:", m, m.qualifier, field))
    verified = []
    for fact in facts:
        member = next(x for x in members if x.url == fact["url"] and x.sid == fact["sourceId"])
        haystack = member.title if fact["field"] == "title" else member.qualifier if fact["field"] == "qualifier" else member.excerpt
        if fact["quote"] and haystack and fact["quote"] in haystack and not safety.check_generated(fact["text"].split(":")[0]):
            if fact not in verified:
                verified.append(fact)
    return verified[:limit]


def _date_parts(members):
    """(dateUtc or None, firstSeen, note). The incident date comes from a database record or a date the text gives
    for the attack; when sources only give their own publication dates the incident date is not stated."""
    structured_dates = [m.event_date for m in members if m.event_kind == "structured"]
    text_dates = [m.event_date for m in members if m.event_kind == "text"]
    first_seen = min((m.published or m.fresh).date() for m in members)
    if structured_dates:
        return min(structured_dates), first_seen, None
    if text_dates:
        return min(text_dates), first_seen, None
    bounds = sorted((m.month_bound, m) for m in members if m.month_bound)
    note = f"incident date not stated; first coverage {first_seen.isoformat()}"
    if bounds:
        bound, m = bounds[0]
        note += f"; the attack was before {bound.isoformat()}, per {m.publisher}"
    return None, first_seen, note


def build_incident(members, run_date, carried=(), previous_id=None):
    members = sorted(members, key=lambda m: (TIER_RANK[m.tier], m.fresh))
    name, other_names = _display_name(members)
    if not name:
        name = "Unknown subject"
    kind, topic, type_reason, generic = _type_choice(members)
    if any(classify.fake_job_signal(f"{m.title} {m.excerpt}") for m in members if m.tier in ("A", "B")):
        topic = "fake-job-malware"
    topic = topic or DEFAULT_TOPIC.get(kind)
    date, first_seen, date_note = _date_parts(members)
    chains = []
    for m in members:
        for chain in m.chains:
            if chain not in chains:
                chains.append(chain)
    losses = []
    for m in members:
        for value, quote, field in m.amounts:
            entry = {"amountUsd": value, "by": m.sid, "url": m.url, "quote": quote, "field": field, "tier": m.tier}
            qual = classify.qualifier_of(quote)
            if qual:
                entry["qualifier"] = qual
            if m.possible and m.kind != "structured":
                entry["includesPossible"] = True
            if not any(e["by"] == entry["by"] and e["url"] == entry["url"] and abs(e["amountUsd"] - value) < 0.5 for e in losses):
                losses.append(entry)
    for c in carried:
        # figures a carried-over source stated: still reported by it, the article has only left the feed
        for entry in c.losses or ():
            if not any(e["by"] == entry.get("by") and e["url"] == entry.get("url") and abs(e["amountUsd"] - float(entry.get("amountUsd") or 0)) < 0.5
                       for e in losses):
                losses.append(dict(entry, carried=True))
    aliases = set().union(*(m.aliases for m in members)) | (aliases_for(name) if name != "Unknown subject" else set())
    status_members = [m for m in members if not (m.event_kind == "text" and date and abs((m.event_date - date).days) > 3
                                                 and not m.follow_up)]
    status, status_reason = _status(status_members, carried, aliases)
    mech_status, mech_member = _mechanism(members, kind, generic)
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
    possible = sorted({e["by"] for e in losses if e.get("includesPossible")})
    if possible:
        notes.append("A figure from " + ", ".join(possible) + " includes amounts the source says may have been lost: "
                     "quote it with that caveat or not at all.")
    if status == "developing":
        notes.append("Label as developing. Attribute every line to its source.")
    if date_note:
        notes.append(date_note[0].upper() + date_note[1:] + ".")
    if mech_status != "stated":
        who = f" per {mech_member.publisher}" if mech_member else ""
        notes.append(f"Mechanism {mech_status}{who}: say it only with that qualifier and attribution, never as fact.")
    legal = sorted({t for m in members for t in m.legal})
    if legal:
        notes.append("Legal matter (" + ", ".join(legal[:6]) + "): allegations and filings are not findings; name no individuals.")
    if any(m.price for m in members):
        notes.append("Some source text discusses token prices; do not repeat price talk.")
    if any(m.redactions["names"] for m in members):
        notes.append("Personal names were redacted from source text.")
    if any(m.redactions["code"] for m in members):
        notes.append("Addresses or code identifiers were removed from source text (concept level only).")
    listed = sorted({m.publisher for m in members if m.listed})
    if listed:
        notes.append(", ".join(listed) + " lists other outlets' reports (discovery only): read the original report at "
                     "each link before using any fact, and cite that outlet, never the listing.")
    unverified = sorted({m.sid for m in members if m.tracker and m.reference_url
                         and re.search(r"^https?://(?:www\.|mobile\.)?(?:x|twitter)\.com/", m.reference_url, re.I)})
    if unverified:
        notes.append(", ".join(unverified) + " cites only an X post for this record; the radar cannot read it (unverified).")
    side = next((m for m in members if m.user_side and m.tier in ("A", "B")), None) or next((m for m in members if m.user_side), None)
    # a headline about users losing funds, not one that only gives users advice ("users told to revoke approvals")
    legacy_user = [m for m in members if m.retail and re.search(
        r"\busers?(?:\(s\))?\s+(?:lose|lost|losing|drained|robbed|phished|scammed|exploited|targeted|hit)\b|"
        r"\bwallets?\s+(?:lose|lost|drained)\b", m.title, re.I)]
    user_side = bool(side) or (bool(legacy_user) and kind in ("other", "exploit"))
    if user_side:
        why = f" ({side.user_side}, per {side.publisher})" if side else ""
        notes.append(f"User-side incident{why}: do not imply the protocol or vendor itself was breached unless a source says so.")
    label = classify.TYPE_LABEL[kind]
    subject = f"{name} users" if user_side else name
    if mech_status == "suspected" and kind != "other":
        label = f"{label} (suspected, per {mech_member.publisher})" if mech_member else f"{label} (suspected)"
    elif mech_status == "unknown" and kind != "other":
        label = f"{label} (mechanism unknown{f', per {mech_member.publisher}' if mech_member else ''})"
    if status == "developing":
        title = f"{subject}: reported {label} (developing)"
    else:
        title = f"{subject}: {label}"
    lane = incident_lane(members)
    if lane != "crypto" and kind in classify.AI_TYPES:
        notes.append("AI security: explain the mechanism at concept level only (no prompts, payloads or steps), "
                     "attribute every claim to the vendor, researcher or outlet, and give users one fix.")
    incident = {
        "id": previous_id or f"{(date or first_seen).isoformat()}-{slugify(name)}",
        "title": title,
        "protocol": name,
        "lane": lane,
        "chains": chains,
        "type": kind,
        "dateUtc": date.isoformat() if date else None,
        "firstSeenUtc": first_seen.isoformat(),
        "reportedLosses": losses,
        "status": status,
        "statusReason": status_reason,
        "sources": [_source_entry(m) for m in members] + [c.entry for c in carried if c.entry],
        "postMortemUrl": post_mortem,
        "evergreenTopic": topic,
        "notes": notes,
        "typeReason": type_reason,
        "mechanismStatus": mech_status,
        "mechanismKnown": mech_status == "stated",
        "userSide": user_side,
        "facts": build_facts(members),
    }
    if date_note:
        incident["dateNote"] = date_note
    if mech_member is not None:
        incident["mechanismNote"] = {"sourceId": mech_member.sid, "url": mech_member.url, "publisher": mech_member.publisher,
                                     "status": mech_status, "text": mech_member.qualifier}
    if carried:
        incident["carriedSources"] = sorted({c.url for c in carried if c.url})
    return incident


def unclustered_entry(m):
    return {
        "sourceId": m.sid,
        "lane": m.lane or "crypto",
        "tier": m.tier,
        "title": m.title,
        "url": m.url,
        "publishedUtc": m.item.get("publishedUtc"),
        "excerpt": m.excerpt,
        "reason": ("no confident subject in the headline" if m.incident else "security topic, not an incident report"),
    }


def freshest_member(members):
    """The freshest tier-A/B member that is not a newsletter round-up (then tier C, then anything): aggregator
    timestamps and weekly round-ups alone never make an old incident look new."""
    pool = ([m for m in members if m.tier in ("A", "B") and not m.roundup]
            or [m for m in members if not m.roundup] or list(members))
    return max(pool, key=lambda m: m.fresh)


def freshest(members):
    return freshest_member(members).fresh


def clean_join(parts):
    return clean_ws(" ".join(p for p in parts if p))
