"""collect: fetch (or read fixtures) -> parse -> mentions -> incidents -> rank -> write."""

import datetime as dt
import json
import os
import urllib.parse

from . import SCHEMA, VERSION, cluster, fetch, history as history_mod, score as score_mod, safety
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
    mentions, counts = cluster.build_mentions(results, sources_by_id, run_date, hist["seenKeys"], has_history)
    clusters, unclustered = cluster.cluster_mentions(mentions)

    window_start = run_date - dt.timedelta(days=window_days - 1)
    fresh_from = day_start(window_start)
    fresh_to = day_start(run_date) + dt.timedelta(days=1)
    lookback_from = run_date - dt.timedelta(days=lookback_days)

    built = []
    for members in clusters:
        incident = cluster.build_incident(members, run_date)
        built.append((incident, members))
    type_counts_all = []
    for position, (incident, _) in enumerate(built):
        date = dt.date.fromisoformat(incident["dateUtc"] or incident["firstSeenUtc"])
        if lookback_from <= date < run_date:
            type_counts_all.append((position, incident["type"]))

    candidates = []
    corrections = []
    for index, (incident, members) in enumerate(built):
        latest = cluster.freshest(members)
        if not (fresh_from <= latest < fresh_to):
            continue
        previous = history_mod.match_previous(incident, hist)
        if previous:
            # the same incident as in an earlier live run: keep its id (stable across days), and let the sources that
            # have since rotated out of their feeds still count for the status, unless a source now retracts
            retracted = any(m.retraction for m in members)
            carried = [] if retracted else history_mod.carried_sources(previous, incident)
            incident = cluster.build_incident(members, run_date, carried=carried, previous_id=previous.get("id"))
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
            corrections.append({"incidentId": incident["id"], "protocol": incident["protocol"],
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
    candidates.sort(key=lambda inc: (-inc["score"]["total"], -max_loss(inc), inc["protocol"].lower()))
    top = candidates[:TOP_N]
    also = candidates[TOP_N:]
    # Market stories that only mention a hack in passing are not listed (no price talk).
    loose = [cluster.unclustered_entry(m) for m in unclustered
             if fresh_from <= m.fresh < fresh_to and not safety.price_talk(m.title)]
    loose.sort(key=lambda e: (e["tier"], e["publishedUtc"] or ""), reverse=False)

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
            "kind": source["kind"],
            "url": source["url"],
            "status": result.get("status"),
            "httpStatus": result.get("httpStatus"),
            "fetchedUtc": result.get("fetchedUtc"),
            "items": len(result.get("items", [])),
            "relevant": stats["relevant"],
            "incidentItems": stats["incident"],
            "warnings": [safety.sanitize(w)[0] for w in result.get("warnings", [])],
        })
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
        ],
        "history": {"files": hist["files"], "previousIncidents": len(hist["incidents"])},
        "counts": {
            "sourcesTotal": len(source_rows),
            "sourcesOk": sum(1 for r in source_rows if r["status"] in ("ok", "cached", "not-modified")),
            "items": sum(r["items"] for r in source_rows),
            "securityRelevant": sum(r["relevant"] for r in source_rows),
            "incidentsBuilt": len(built),
            "candidates": len(candidates),
            "unclustered": len(loose),
        },
        "sources": source_rows,
        "top": top,
        "alsoSeen": also,
        "unclustered": loose,
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
    return doc, json_path, md_path


def _atomic_write(path, text):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(text)
    os.replace(tmp, path)
