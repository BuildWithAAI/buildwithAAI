"""Candidate ideas in the format of content/<channel>/backlog.json (another workflow's file: read, never written).

Each export holds only our own text in its ideas, so any idea can be copied into the committed backlog as is. The
YouTube evidence (links, titles, counts) sits in a separate top-level "evidence" map that expires with the report:
API Data may not be stored beyond 30 days (Developer Policies III.E.4), and the backlog is permanent and public.

validate_backlog() mirrors parseBacklog() in scripts/batch/lib/backlog.ts as read on 2026-11-24; the conformance test
runs the real TypeScript parser too whenever node and that file are present."""

import copy
import datetime as dt
import re

ID = re.compile(r"^[a-z0-9][a-z0-9-]{1,63}$")
TOPIC = re.compile(r"^[a-z0-9][a-z0-9-]{1,47}$")
TAG = re.compile(r"^[a-z0-9][a-z0-9-]*$")
WEEK = re.compile(r"^\d{4}-W\d{2}$")
RESEARCH = re.compile(r"^content/[a-z0-9-]+/[a-z0-9_-]+/research\.md$")
FACT_STATUSES = ("fact-bank", "researched", "research needed")
IDEA_STATUSES = ("idea", "published", "dropped")
DUB_LANGS = ("es", "pt-br", "hi", "it", "zh")


def idea_record(idea, priority, run_date, expires_on, total, report_path=None):
    """One backlog idea (our text only) from a topic-finder idea."""
    fact_tags = [t for t in dict.fromkeys([idea["topic"], idea["subtopic"] or "", idea["evergreenTopic"]]) if t and TAG.match(t)]
    related = [m["id"] for m in idea["backlog"]["matches"] if m["relation"] == "related" and m.get("id")]
    notes = (
        f"Topic finder {run_date}: rank {idea['rank']} of {total} (our score {idea['score']:.0f}, from {len(idea['evidence'])} outlier video"
        f"{'s' if len(idea['evidence']) != 1 else ''} on {idea['evidenceChannels']} channel{'s' if idea['evidenceChannels'] != 1 else ''}). "
        f"The YouTube evidence is in {report_path or f'out/topics/{run_date}.md'} until {expires_on} and is kept out of this idea on purpose: "
        "YouTube API data may not be stored beyond 30 days."
    )
    if related:
        notes += f" Related backlog ideas: {', '.join(related)}."
    if not idea["copyGuard"]["title"]["ok"]:
        notes += " The working title is close to a source title: rewrite it before planning."
    return {
        "id": idea["id"],
        "slug": idea["id"],
        "title": idea["pitch"]["workingTitle"],
        "format": idea["format"],
        "status": "idea",
        "priority": priority,
        "week": None,
        "role": None,
        "angle": idea["pitch"]["angle"],
        "evergreenTopic": idea["evergreenTopic"],
        "relatedTopics": [t for t in idea["evidence"][0]["classification"].get("otherTopics", []) if t != idea["topic"]][:3],
        "factTags": fact_tags,
        "research": None,
        "facts": [{"need": need, "factId": None, "status": "research needed"} for need in idea["facts"]],
        "risks": list(idea["risks"]),
        "languages": {"master": "en", "dubs": list(idea.get("dubs") or ["es", "pt-br"])},
        "shortIdeas": list(idea["pitch"]["shortIdeas"]),
        "notes": notes,
    }


def evidence_record(idea, expires_on):
    return {
        "expiresOn": expires_on,
        "source": "YouTube Data API v3 (data from YouTube); outlier ratios and scores are the topic finder's own metrics",
        "videos": [
            {
                "url": e["url"], "title": e.get("title"), "channelTitle": e.get("channelTitle"), "publishedAt": e.get("publishedAt"),
                "views": e.get("views"), "fetchedAt": e.get("fetchedAt"), "outlierRatio": round(e["outlier"], 2) if e.get("outlier") is not None else None,
                "why": e.get("why"),
            }
            for e in idea["evidence"][:5]
        ],
    }


def build_exports(ideas, channels, run_date, retention_days, top_n, existing=None, dubs=None, report_path=None):
    """{channel: export dict} for every channel with at least one new or related idea (duplicates stay out)."""
    expires_on = (run_date + dt.timedelta(days=int(retention_days))).isoformat()
    exports = {}
    for channel in channels:
        chosen = [i for i in ideas if i["channel"] == channel and i["backlog"]["status"] != "duplicate"][:top_n]
        if not chosen:
            continue
        rules = []
        backlog = (existing or {}).get(channel)
        if isinstance(backlog, dict) and isinstance(backlog.get("rules"), list):
            rules = [r for r in backlog["rules"] if isinstance(r, str)]
        out_ideas, evidence = [], {}
        for priority, idea in enumerate(chosen, 1):
            if dubs:
                idea = dict(idea, dubs=list(dubs))
            out_ideas.append(idea_record(idea, priority, run_date.isoformat(), expires_on, len(ideas), report_path))
            evidence[idea["id"]] = evidence_record(idea, expires_on)
        exports[channel] = {
            "version": 1,
            "channel": channel,
            "updated": run_date.isoformat(),
            "status": (
                "Topic-finder candidates pending the owner's review, NOT part of the planned backlog. Copy chosen ideas "
                f"into content/{channel}/backlog.json (renumber priority there); never copy the 'evidence' map."
            ),
            "rules": rules,
            "ideas": out_ideas,
            "generatedBy": "scripts/topics (topic finder)",
            "evidence": evidence,
        }
    return exports


def merge_preview(existing, export):
    """The channel's backlog with the candidates appended after its last priority (a preview file; the real backlog
    is never edited here). Evidence is left out."""
    merged = copy.deepcopy(existing) if isinstance(existing, dict) else {"version": 1, "channel": export["channel"], "updated": export["updated"], "status": "preview", "rules": export.get("rules", []), "ideas": []}
    start = max([i.get("priority", 0) for i in merged.get("ideas", []) if isinstance(i.get("priority"), int)] or [0])
    for n, idea in enumerate(export["ideas"], 1):
        added = copy.deepcopy(idea)
        added["priority"] = start + n
        merged["ideas"].append(added)
    merged["updated"] = export["updated"]
    return merged


def _is_date(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return False
    try:
        dt.date.fromisoformat(value)
    except ValueError:
        return False
    return True


def validate_backlog(data, formats, other_slugs=None):
    """Problems parseBacklog() would report (empty list = valid). formats: the channel's format ids."""
    problems = []
    bad = problems.append
    if not isinstance(data, dict) or data.get("version") != 1:
        return ['expected a backlog {"version": 1, "channel": ..., "ideas": [...]}']
    if not _is_date(data.get("updated")):
        bad('"updated" must be a date (YYYY-MM-DD)')
    ideas = data.get("ideas")
    if not isinstance(ideas, list) or not 1 <= len(ideas) <= 100:
        bad('"ideas" must hold 1-100 ideas')
        ideas = ideas if isinstance(ideas, list) else []
    seen = set()
    for i, raw in enumerate(ideas):
        at = f"ideas[{i}]"
        if not isinstance(raw, dict):
            bad(f"{at} must be an object")
            continue
        iid = raw.get("id") if isinstance(raw.get("id"), str) else ""
        where = f'idea "{iid}"' if iid else at
        if not ID.match(iid):
            bad(f"{at}.id must be lowercase letters, digits and dashes (2-64)")
        slug = iid if raw.get("slug") is None else raw.get("slug")
        if not isinstance(slug, str) or not ID.match(slug) or slug.startswith("_"):
            bad(f"{where}: slug must be lowercase letters, digits and dashes")
        title = raw.get("title") if isinstance(raw.get("title"), str) else ""
        if not title or len(title) > 100 or "<" in title or ">" in title:
            bad(f"{where}: title must be 1-100 characters with no < or >")
        if raw.get("format") not in formats:
            bad(f"{where}: format \"{raw.get('format')}\" is not one of {', '.join(formats)}")
        if raw.get("status", "idea") not in IDEA_STATUSES:
            bad(f"{where}: status must be {', '.join(IDEA_STATUSES)}")
        priority = raw.get("priority")
        if not isinstance(priority, int) or isinstance(priority, bool) or priority < 1:
            bad(f"{where}: priority must be a whole number of at least 1")
        week = raw.get("week")
        if week is not None and not (isinstance(week, str) and WEEK.match(week)):
            bad(f"{where}: week must be null or an ISO week like 2026-W49")
        angle = raw.get("angle") if isinstance(raw.get("angle"), str) else ""
        if len(angle) < 40:
            bad(f"{where}: angle must say in at least a sentence what the video argues and how it ends")
        topic = raw.get("evergreenTopic") if isinstance(raw.get("evergreenTopic"), str) else ""
        if not TOPIC.match(topic):
            bad(f'{where}: evergreenTopic must be a topic id like "drainers"')
        tags = raw.get("factTags")
        if isinstance(tags, list) and any(not (isinstance(t, str) and TAG.match(t)) for t in tags):
            bad(f"{where}: factTags must be lowercase kebab-case tags")
        research = raw.get("research")
        if research is not None and not (isinstance(research, str) and RESEARCH.match(research)):
            bad(f"{where}: research must be null or content/<channel>/<slug>/research.md")
        facts = raw.get("facts")
        if not isinstance(facts, list) or not facts:
            bad(f"{where}: facts must list the facts the script needs")
        for k, f in enumerate(facts if isinstance(facts, list) else []):
            if not isinstance(f, dict) or not isinstance(f.get("need"), str) or not f["need"] or f.get("status") not in FACT_STATUSES:
                bad(f"{where}: facts[{k}] needs {{need, factId, status}}")
                continue
            if f["status"] == "fact-bank" and not f.get("factId"):
                bad(f"{where}: facts[{k}] has status \"fact-bank\" but no factId")
            if f["status"] != "fact-bank" and f.get("factId"):
                bad(f"{where}: facts[{k}] has a factId, so its status must be \"fact-bank\"")
        risks = raw.get("risks")
        if not isinstance(risks, list) or not any(isinstance(r, str) and r.strip() for r in risks):
            bad(f"{where}: risks must list at least one risk note")
        langs = raw.get("languages") if isinstance(raw.get("languages"), dict) else {}
        if langs.get("master") != "en":
            bad(f'{where}: languages.master must be "en" (the master language)')
        dubs = langs.get("dubs") if isinstance(langs.get("dubs"), list) else []
        if any(d not in DUB_LANGS for d in dubs):
            bad(f"{where}: languages.dubs may only hold {', '.join(DUB_LANGS)}")
        if iid in seen:
            bad(f'idea id "{iid}" is used twice')
        seen.add(iid)
        if other_slugs and slug in other_slugs:
            bad(f'slug "{slug}" is already used by another backlog idea')
    return problems


def find_api_data_leaks(export):
    """Idea fields must not carry YouTube data (links, video ids, counts): returns the offending idea ids."""
    leaks = []
    evidence = export.get("evidence") or {}
    needles = set()
    for ev in evidence.values():
        for v in ev.get("videos", []):
            needles.add(v["url"])
            m = re.search(r"v=([A-Za-z0-9_-]{11})", v["url"])
            if m:
                needles.add(m.group(1))
            if v.get("title") and len(v["title"]) > 12:
                needles.add(v["title"])
            if v.get("channelTitle") and len(v["channelTitle"]) > 3:
                needles.add(v["channelTitle"])
    for idea in export.get("ideas", []):
        blob = repr(idea)
        if "youtube.com" in blob or "youtu.be" in blob or any(n in blob for n in needles):
            leaks.append(idea.get("id"))
    return leaks

