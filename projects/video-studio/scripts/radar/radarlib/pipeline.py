"""collect: fetch (or read fixtures) -> parse -> mentions -> incidents -> rank -> write."""

import datetime as dt
import json
import os
import urllib.parse

from . import SCHEMA, VERSION, classify, cluster, fetch, history as history_mod, score as score_mod, safety
from .parsers import PARSER_VERSION, PARSERS, ParseError
from .render import render_markdown
from .textutil import day_start, iso_z

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))          # scripts/radar
PROJECT = os.path.dirname(os.path.dirname(HERE))                            # projects/video-studio
DEFAULT_SOURCES = os.path.join(HERE, "sources.json")
DEFAULT_FIXTURES = os.path.join(HERE, "fixtures")
DEFAULT_OUT = os.path.join(PROJECT, "content", "zoora-security", "radar")
DEFAULT_CACHE = os.path.join(PROJECT, ".cache", "radar")
DEFAULT_OFFLINE_OUT = os.path.join(DEFAULT_CACHE, "offline-out")
TOP_N = 5


def load_sources(path=DEFAULT_SOURCES):
    with open(path, encoding="utf-8") as fh:
        config = json.load(fh)
    seen = set()
    for source in config["sources"]:
        for key in ("id", "name", "kind", "url", "parser", "tier"):
            if not source.get(key):
                raise ValueError(f"source {source.get('id')!r} is missing {key!r}")
        if source["id"] in seen:
            raise ValueError(f"duplicate source id {source['id']!r}")
        if source["parser"] not in PARSERS:
            raise ValueError(f"source {source['id']!r} has unknown parser {source['parser']!r}")
        if source["tier"] not in ("A", "B", "C"):
            raise ValueError(f"source {source['id']!r} has invalid tier {source['tier']!r}")
        if source["kind"] not in ("json-api", "rss", "atom", "html"):
            raise ValueError(f"source {source['id']!r} has invalid kind {source['kind']!r}")
        if source.get("lane", "crypto") not in ("crypto", "ai", "both"):
            raise ValueError(f"source {source['id']!r} has invalid lane {source.get('lane')!r} (crypto, ai or both)")
        seen.add(source["id"])
    return config


def _parse_with(source, ctx):
    parser = PARSERS[source["parser"]]
    return lambda body, src: parser(body, src, ctx)


def gather(config, run_date, offline, fixtures_dir, cache_dir, now, user_agent, only=None,
           log=print, client=None, max_age_days=120):
    ctx = {"runDate": run_date, "maxAgeDays": max_age_days}
    results = {}
    sources = [s for s in config["sources"] if s.get("enabled", True) and (not only or s["id"] in only)]
    if offline:
        for source in sources:
            result = {"status": None, "httpStatus": None, "fetchedUtc": None, "items": [], "warnings": [], "error": None}
            fixture = source.get("fixture")
            path = os.path.join(fixtures_dir, fixture) if fixture else None
            if not path or not os.path.exists(path):
                result.update(status="skipped", error="no fixture")
                result["warnings"].append("no fixture for offline mode")
                results[source["id"]] = result
                continue
            with open(path, "rb") as fh:
                body = fh.read()
            try:
                items, warnings = _parse_with(source, ctx)(body, source)
                result.update(status="ok", items=items, warnings=list(warnings), fetchedUtc=iso_z(now))
            except Exception as err:  # a parser failure must never crash the run, offline or live
                why = str(err) if isinstance(err, ParseError) else f"{type(err).__name__}: {err}"
                result.update(status="error", error=f"parse failed: {why}")
                result["warnings"].append(f"parse failed: {why}")
                log(f"[radar] {source['id']}: parse failed: {why}")
            results[source["id"]] = result
        return results, 0

    store = fetch.JsonStore(cache_dir) if cache_dir else None
    policy = config.get("policy", {})
    listed = {(urllib.parse.urlsplit(s["url"]).hostname or "").lower() for s in config["sources"] if s.get("url")}
    client = client or fetch.HttpClient(user_agent=user_agent, min_interval=policy.get("minSecondsPerHost", 1.05), log=log,
                                        allowed_hosts=listed)
    robots = fetch.RobotsCache(client, store, now, extra_tokens=policy.get("alsoObeyRobotsTokens", []))
    source_cache = fetch.SourceCache(store) if store else None
    for source in sources:
        log(f"[radar] {source['id']}: {source['url']}")
        results[source["id"]] = fetch.collect_source(
            source, _parse_with(source, ctx), client, robots, source_cache, now, PARSER_VERSION, log=log)
    return results, client.requests


def run_collect(run_date, offline=False, out_dir=None, cache_dir=DEFAULT_CACHE, sources_path=DEFAULT_SOURCES,
                fixtures_dir=DEFAULT_FIXTURES, history_dir=None, now=None, window_days=3, lookback_days=14,
                max_age_days=120, user_agent=None, only=None, log=print, client=None, write=True):
    config = load_sources(sources_path)
    policy = config.get("policy", {})
    user_agent = user_agent or os.environ.get("RADAR_USER_AGENT") or policy.get("userAgent") or fetch.DEFAULT_USER_AGENT
    if now is None:
        now = dt.datetime.now(dt.timezone.utc)
        if offline:
            now = day_start(run_date) + dt.timedelta(hours=12)
    out_dir = out_dir or (DEFAULT_OFFLINE_OUT if offline else DEFAULT_OUT)
    if history_dir is None:
        history_dir = None if offline else out_dir
    sources_by_id = {s["id"]: s for s in config["sources"]}

    results, requests = gather(config, run_date, offline, fixtures_dir, cache_dir, now, user_agent,
                               only=only, log=log, client=client, max_age_days=max_age_days)
    hist = history_mod.load_history(history_dir, run_date, days=lookback_days)
    has_history = bool(hist["files"])
    warnings = []
    problem = classify.allowlist_problem()
    if problem:
        warnings.append(f"{problem}: reporters, agencies and known organisations cannot be told apart from subjects, so "
                        "AI subjects are known AI products and companies only; restore the file")
        log(f"[radar] WARNING: {warnings[-1]}")
    held = []
    run_names = {}
    mentions, counts = cluster.build_mentions(results, sources_by_id, run_date, hist["seenKeys"], has_history,
                                              max_age_days=max_age_days, held=held, run=run_names)
    clusters, unclustered = cluster.cluster_mentions(mentions)
    # sources that never confirm an incident alone (a single researcher's blog): one outlet's vote
    no_solo = frozenset(sid for sid, s in sources_by_id.items() if s.get("confirmsAlone") is False)

    window_start = run_date - dt.timedelta(days=window_days - 1)
    fresh_from = day_start(window_start)
    fresh_to = day_start(run_date) + dt.timedelta(days=1)
    lookback_from = run_date - dt.timedelta(days=lookback_days)

    built = []
    for members in clusters:
        incident = cluster.build_incident(members, run_date, no_solo=no_solo)
        built.append((incident, members))
    type_counts_all = []
    for position, (incident, _) in enumerate(built):
        when = incident["dateUtc"] or incident["firstSeenUtc"]
        if not when:
            continue
        date = dt.date.fromisoformat(when)
        if lookback_from <= date < run_date:
            type_counts_all.append((position, incident["type"]))

    candidates = []
    corrections = []
    listed_only = []
    for index, (incident, members) in enumerate(built):
        latest = cluster.freshest(members)
        if latest is None:
            # only an incident database lists it so far: a lead, never a candidate (the listing date is not coverage)
            listed_at = max((m.listed_at or m.fresh) for m in members)
            if fresh_from <= listed_at < fresh_to:
                listed_only.append(cluster.listed_entry(incident, members))
            continue
        if not (fresh_from <= latest < fresh_to):
            continue
        previous = history_mod.match_previous(incident, hist)
        if previous:
            # the same incident as in an earlier live run: keep its id (stable across days), and let the sources that
            # have since rotated out of their feeds still count for the status, unless a source now retracts
            retracted = any(m.retraction for m in members)
            # carried entries are redacted with today's names (a crypto incident with the crypto items' names only)
            people = run_names.get("peopleCrypto" if incident.get("lane", "crypto") == "crypto" else "people")
            carried = [] if retracted else history_mod.carried_sources(previous, incident, no_solo, people=people,
                                                                       known=run_names.get("known", frozenset()))
            incident = cluster.build_incident(members, run_date, carried=carried, previous_id=previous.get("id"),
                                              no_solo=no_solo)
            built[index] = (incident, members)
        type_counts = {}
        for other, kind in type_counts_all:
            if other != index:
                type_counts[kind] = type_counts.get(kind, 0) + 1
        incident["score"] = score_mod.score(incident, members, run_date, window_start, previous, type_counts)
        incident["shortReady"] = score_mod.sourcing_bar(incident, incident["score"])
        changes = history_mod.corrections(incident, previous)
        if changes:
            incident["notes"].append("Changed since the " + previous["radarDate"] + " radar: " + "; ".join(changes) + ".")
            # the incident's id is read after ids are made unique below (a renamed duplicate gets "-2")
            corrections.append({"incident": incident, "protocol": incident["protocol"],
                                "previousRadarDate": previous["radarDate"], "changes": changes})
        for name in ("title",):
            problems = safety.check_generated(incident[name])
            if problems:
                incident["notes"].append(f"Generated {name} flagged: {', '.join(problems)}.")
        candidates.append(incident)

    def max_loss(inc):
        return max([e["amountUsd"] for e in inc["reportedLosses"]] or [0])

    # ids are unique within a run, even when two incidents share a subject and date (or one earlier entry)
    seen_ids = {}
    for inc in sorted(candidates, key=lambda i: (i["dateUtc"] or i["firstSeenUtc"], i["title"])):
        base = inc["id"]
        seen_ids[base] = seen_ids.get(base, 0) + 1
        if seen_ids[base] > 1:
            inc["id"] = f"{base}-{seen_ids[base]}"
    corrections = [{"incidentId": c["incident"]["id"], **{k: v for k, v in c.items() if k != "incident"}}
                   for c in corrections]
    candidates.sort(key=lambda inc: (-inc["score"]["total"], -max_loss(inc), inc["protocol"].lower()))
    top = candidates[:TOP_N]
    also = candidates[TOP_N:]
    # each lane's best incidents (an incident in both lanes counts in each), so an AI story is never lost below the
    # crypto ones in the human brief, and the daily step can see both
    lane_top = {lane: [inc["id"] for inc in candidates if inc.get("lane", "crypto") in (lane, "both")][:TOP_N]
                for lane in ("crypto", "ai")}
    # Market stories that only mention a hack in passing are not listed (no price talk).
    loose = [cluster.unclustered_entry(m) for m in unclustered
             if fresh_from <= m.fresh < fresh_to and not safety.price_talk(m.title)]
    loose.sort(key=lambda e: (e["tier"], e["publishedUtc"] or e.get("listedUtc") or ""), reverse=False)
    listed_only.sort(key=lambda e: e["listedUtc"] or "", reverse=True)
    # items the AI lane holds back for the owner (sexual-abuse or intimate-image stories): counted, with their reason
    # and outlet, never their words; the fresh window applies as for unclustered items
    owner_review = [entry for entry, when, _ in held if when is not None and fresh_from <= when < fresh_to]
    owner_review.sort(key=lambda e: (e["date"] or "", e["sourceId"]), reverse=True)
    held_urls = {entry["urlRef"]: url for entry, when, url in held if url and entry.get("urlRef")
                 and when is not None and fresh_from <= when < fresh_to}
    if owner_review:
        by_reason = {}
        for entry in owner_review:
            by_reason[entry["reason"]] = by_reason.get(entry["reason"], 0) + 1
        warnings.append(f"{len(owner_review)} AI-lane item(s) held back for the owner's review, words withheld: "
                        + "; ".join(f"{reason} ({n})" for reason, n in sorted(by_reason.items()))
                        + ". See ownerReview in the radar file; the links are in the gitignored withheld-links cache")

    seen_keys = sorted({m.key for m in mentions if m.kind == "structured" and m.event_date
                        and (run_date - m.event_date).days <= lookback_days})
    source_rows = []
    for source in config["sources"]:
        if not source.get("enabled", True) or (only and source["id"] not in only):
            continue
        result = results.get(source["id"], {})
        stats = counts.get(source["id"], {"relevant": 0, "incident": 0, "excluded": 0})
        source_rows.append({
            "id": source["id"],
            "name": source["name"],
            "tier": source["tier"],
            "lane": source.get("lane", "crypto"),
            "kind": source["kind"],
            "url": source["url"],
            "status": result.get("status"),
            "httpStatus": result.get("httpStatus"),
            "fetchedUtc": result.get("fetchedUtc"),
            "items": len(result.get("items", [])),
            "relevant": stats["relevant"],
            "relevantByLane": dict(sorted(stats.get("lanes", {}).items())),
            "incidentItems": stats["incident"],
            "heldForOwner": stats.get("held", 0),
            "warnings": [safety.sanitize(w)[0] for w in result.get("warnings", [])],
        })
        if stats.get("heldReasons"):
            # every item of the feed the AI lane held back, by reason (the fresh ones are also listed in ownerReview)
            source_rows[-1]["heldForOwnerReasons"] = dict(sorted(stats["heldReasons"].items()))
    doc = {
        "schema": SCHEMA,
        "radarVersion": VERSION,
        "parserVersion": PARSER_VERSION,
        "runDate": run_date.isoformat(),
        "generatedUtc": iso_z(now),
        "mode": "offline-fixtures" if offline else "live",
        "userAgent": None if offline else user_agent,
        "httpRequests": requests,
        "window": {"freshFrom": iso_z(fresh_from), "freshTo": iso_z(fresh_to), "days": window_days,
                   "lookbackDays": lookback_days, "clusterLookbackDays": max_age_days},
        "scoring": {"weights": dict(score_mod.WEIGHTS), "method": "see scripts/radar/README.md#ranking"},
        "rules": [
            "Every fact traces to a stored source excerpt or title that contains it (facts[].quote).",
            "Loss amounts are reported by a named source and never averaged.",
            "Unconfirmed incidents are labelled developing.",
            "No suspect or individual names; names in source text are redacted.",
            "Mechanisms at concept level only: no code, function names, addresses or step lists.",
            "No price or investment talk.",
            "Two lanes: crypto security and AI security; every incident and item carries its lane (crypto, ai or both).",
        ],
        "warnings": warnings,
        "history": {"files": hist["files"], "previousIncidents": len(hist["incidents"])},
        "counts": {
            "sourcesTotal": len(source_rows),
            "sourcesOk": sum(1 for r in source_rows if r["status"] in ("ok", "cached", "not-modified")),
            "items": sum(r["items"] for r in source_rows),
            "securityRelevant": sum(r["relevant"] for r in source_rows),
            "incidentsBuilt": len(built),
            "candidates": len(candidates),
            "unclustered": len(loose),
            "listedOnly": len(listed_only),
            "ownerReview": len(owner_review),
            "candidatesByLane": {lane: sum(1 for inc in candidates if inc.get("lane", "crypto") == lane)
                                 for lane in ("crypto", "ai", "both")},
        },
        "sources": source_rows,
        "laneTop": lane_top,
        "top": top,
        "alsoSeen": also,
        "unclustered": loose,
        "listedOnly": listed_only,
        "ownerReview": owner_review,
        "corrections": corrections,
        "seenRecordKeys": seen_keys,
    }
    json_path = md_path = None
    if write:
        os.makedirs(out_dir, exist_ok=True)
        json_path = os.path.join(out_dir, f"{run_date.isoformat()}.json")
        md_path = os.path.join(out_dir, f"{run_date.isoformat()}.md")
        _atomic_write(json_path, json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
        _atomic_write(md_path, render_markdown(doc))
        withheld = {m.url_ref: m.url for m in mentions if m.url_ref}
        withheld.update(held_urls)
        if withheld and cache_dir:
            # the full links the brief withholds (they spell a person's name): kept in the gitignored cache only, for
            # the owner
            links_dir = os.path.join(cache_dir, "withheld-links")
            os.makedirs(links_dir, exist_ok=True)
            _atomic_write(os.path.join(links_dir, f"{run_date.isoformat()}.json"),
                          json.dumps(dict(sorted(withheld.items())), indent=2) + "\n")
    return doc, json_path, md_path


def _atomic_write(path, text):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(text)
    os.replace(tmp, path)
