"""The topic-finder run: search our niches, read statistics, find each channel's baseline, score outliers, turn
them into ranked ideas, and write out/topics/<date>.json, .md and the backlog-format exports.

Order of work (so a quota cap cuts the least valuable calls):
1. search.list per query, by query priority (Search Queries bucket);
2. videos.list for every result (statistics, durations, aspect ratio);
3. filters: window, live, own channels, exclusions, view floors;
4. channels.list for the remaining candidates' channels;
5. baselines (uploads playlist + videos.list) for channels in order of a free pre-score (views / lifetime average);
   channels the cap does not reach keep an estimated baseline, flagged;
6. scoring, ideas, exports."""

import datetime as dt
import json
import os
import time

from . import baseline as baseline_mod
from . import cache as cache_mod
from . import classify, contracts, export, fake_api, ideas as ideas_mod, quota, report, score, text
from .api import ApiError, BudgetExceeded, YouTubeClient
from .http import UrllibTransport

TOPICS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STUDIO = os.path.dirname(os.path.dirname(TOPICS_DIR))
DEFAULT_CONFIG = os.path.join(TOPICS_DIR, "config.json")
DEFAULT_QUOTA = os.path.join(TOPICS_DIR, "quota.json")
DEFAULT_TAXONOMY = os.path.join(TOPICS_DIR, "taxonomy.json")
DEFAULT_FIXTURES = os.path.join(TOPICS_DIR, "fixtures", "api")
DEFAULT_OUT = os.path.join(STUDIO, "out", "topics")
DEFAULT_FIXTURE_OUT = os.path.join(STUDIO, "out", "topics", "fixtures")
DEFAULT_CACHE = os.path.join(STUDIO, ".cache", "topics")
DEFAULT_LEDGER = os.path.join(STUDIO, ".cache", "topics-ledger.json")
OWNER_TIME_ZONE = "America/Chicago"


class UsageError(ValueError):
    pass


class PolicyBlocked(Exception):
    """A live run the owner has not cleared (YouTube API policy or a missing key)."""


class RunFailed(Exception):
    pass


def _read_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _maybe_json(path):
    try:
        return _read_json(path)
    except (OSError, ValueError):
        return None


def load_context(studio=STUDIO, config_path=DEFAULT_CONFIG, quota_path=DEFAULT_QUOTA, taxonomy_path=DEFAULT_TAXONOMY):
    try:
        config = _read_json(config_path)
    except (OSError, ValueError) as err:
        raise UsageError(f"{config_path}: {err}") from None
    if not isinstance(config, dict) or config.get("version") != 1:
        raise UsageError(f"{config_path}: expected {{\"version\": 1, ...}}")
    try:
        table = quota.QuotaTable.load(quota_path)
    except (OSError, ValueError) as err:
        raise UsageError(str(err)) from None
    warnings = []
    batch = _maybe_json(os.path.join(studio, "scripts", "batch", "config.json"))
    formats, names = {}, {}
    if isinstance(batch, dict) and isinstance(batch.get("channels"), list):
        for c in batch["channels"]:
            if isinstance(c, dict) and isinstance(c.get("formats"), dict):
                formats[c["channel"]] = list(c["formats"].keys())
                if c.get("name"):
                    names[c["channel"]] = c["name"]
    if not formats:
        formats = {k: v for k, v in (config.get("channelFormats") or {}).items() if isinstance(v, list)}
        warnings.append("scripts/batch/config.json was not found; channel formats come from scripts/topics/config.json channelFormats.")
    evergreen = {}
    for channel in formats:
        data = _maybe_json(os.path.join(studio, "content", channel, "channel.json"))
        if isinstance(data, dict) and isinstance(data.get("evergreen"), dict):
            evergreen[channel] = data["evergreen"]
    security_keys = set(evergreen.get("zoora-security", {}) or (config.get("evergreenFallback") or {}).get("zoora-security", []))
    try:
        taxonomy = classify.Taxonomy.load(taxonomy_path, formats, security_keys or None)
    except (OSError, ValueError) as err:
        raise UsageError(f"{taxonomy_path}: {err}") from None
    backlogs = {}
    for channel in formats:
        path = os.path.join(studio, "content", channel, "backlog.json")
        data = _maybe_json(path)
        backlogs[channel] = data if isinstance(data, dict) else None
        if data is None:
            warnings.append(f"content/{channel}/backlog.json was not found or unreadable; ideas were not checked against it.")
    return {
        "studio": studio, "config": config, "quota": table, "taxonomy": taxonomy, "formats": formats, "names": names,
        "evergreen": evergreen, "backlogs": backlogs, "warnings": warnings,
    }


def compliance_gate(config, mode):
    """Live runs need the owner's record that YouTube accepted the derived-metrics amendment for this project."""
    if mode != "live":
        return
    amendment = ((config.get("compliance") or {}).get("derivedMetricsAmendment") or {})
    if amendment.get("accepted") is True and amendment.get("acceptedOn"):
        return
    raise PolicyBlocked(
        "Live runs are blocked until YouTube accepts this project's use of derived metrics.\n"
        "The outlier ratio, the engagement score and the ranking are metrics derived from YouTube API Data. YouTube's "
        "Developer Policies (III.E.4) forbid derived metrics unless the API project has accepted the 'Additional "
        f"policies for derived metrics and data storage' ({contracts.POLICY['derivedMetrics']}).\n"
        f"To accept it: submit the YouTube API Services Audit and Quota Extension Form ({contracts.POLICY['auditForm']}), "
        "choose 'Section 5: Use Cases, API Integration, and Feature Implementation' and then 'Analytics & Reporting', "
        "and wait for YouTube's confirmation. Then set compliance.derivedMetricsAmendment.accepted to true, with "
        "acceptedOn (YYYY-MM-DD) and YouTube's reference, in scripts/topics/config.json.\n"
        "Fixture runs (--fixtures) use synthetic data and are not affected."
    )


def window_start(run_date, days):
    """UTC midnight of the run date minus the window: a whole-day boundary keeps search answers cacheable all day."""
    midnight = dt.datetime.combine(run_date, dt.time(0, 0), tzinfo=dt.timezone.utc)
    return midnight - dt.timedelta(days=days)


def today_in_owner_zone(now=None):
    import zoneinfo
    now = now or dt.datetime.now(dt.timezone.utc)
    return now.astimezone(zoneinfo.ZoneInfo(OWNER_TIME_ZONE)).date()


def _select_queries(config, only=None, langs=None):
    queries = [q for q in config.get("queries", []) if isinstance(q, dict)]
    if langs:
        queries = [q for q in queries if q.get("lang") in langs]
    if only:
        queries = [q for q in queries if q.get("id") in only or q.get("niche") in only]
    known_langs = set(config.get("languages", {}))
    for q in queries:
        if q.get("lang") not in known_langs:
            raise UsageError(f"query {q.get('id')}: language {q.get('lang')!r} is not in config.json languages")
        if not q.get("q") or not q.get("id"):
            raise UsageError("every query needs an id and a q")
    return sorted(queries, key=lambda q: (q.get("priority", 9), q["id"]))


def _floor_lang(lang, floors_for_format):
    return lang if lang in floors_for_format else "en"


def run_find(opts):
    """opts: dict with run_date, now, mode ('live'|'fixtures'), api_key, max_units, max_searches and optional paths,
    filters, transport (tests), sleep (tests), log. Returns (doc, written paths)."""
    log = opts.get("log") or (lambda msg: None)
    now = opts.get("now") or dt.datetime.now(dt.timezone.utc)
    run_date = opts.get("run_date") or today_in_owner_zone(now)
    mode = opts.get("mode", "live")
    ctx = load_context(opts.get("studio", STUDIO), opts.get("config_path", DEFAULT_CONFIG), opts.get("quota_path", DEFAULT_QUOTA), opts.get("taxonomy_path", DEFAULT_TAXONOMY))
    config, table, taxonomy = ctx["config"], ctx["quota"], ctx["taxonomy"]
    compliance_gate(config, mode)
    if mode == "live" and not opts.get("api_key") and not opts.get("transport"):
        raise PolicyBlocked(f"{contracts.KEY_ENV} is not set. See scripts/topics/README.md, 'What the owner provides'.")
    retention = cache_mod.clamp_days(opts.get("retention_days", (config.get("compliance") or {}).get("retentionDays", 30)))
    out_dir = opts.get("out_dir") or (DEFAULT_OUT if mode == "live" else DEFAULT_FIXTURE_OUT)
    cache_dir = opts.get("cache_dir") if "cache_dir" in opts else (DEFAULT_CACHE if mode == "live" else None)
    use_cache = opts.get("use_cache", True) and bool(cache_dir)
    pruned_cache = cache_mod.prune_cache(cache_dir, now, retention) if cache_dir else 0
    pruned_reports = cache_mod.prune_reports(out_dir, run_date, retention)
    warnings = list(ctx["warnings"])

    ledger_path = opts.get("ledger_path") if "ledger_path" in opts else (DEFAULT_LEDGER if mode == "live" else None)
    ledger = quota.Ledger(ledger_path, now_fn=lambda: now, time_zone=table.reset_time_zone)
    requested = {"default": int(opts.get("max_units", 2000)), "search": int(opts.get("max_searches", 30))}
    for bucket in table.buckets():
        requested.setdefault(bucket, 0)
    caps, cap_notes = quota.effective_caps(table, requested, ledger)
    budget = quota.QuotaBudget(table, caps, ledger)
    cache = cache_mod.DiskCache(cache_dir if use_cache else None, config.get("cacheTtlHours"), lambda: now, read=not opts.get("refresh"), write=True)

    if opts.get("transport") is not None:
        transport = opts["transport"]
    elif mode == "fixtures":
        fixtures_dir = opts.get("fixtures_dir", DEFAULT_FIXTURES)
        transport = fake_api.FakeYouTube(fake_api.load_db(os.path.join(fixtures_dir, "db.json")), opts.get("failures"), os.path.join(fixtures_dir, "errors"))
    else:
        transport = UrllibTransport(opts["api_key"], key_in_query=bool(opts.get("key_in_query")))
    client = YouTubeClient(transport, budget, cache, log=log, sleep=opts.get("sleep") or time.sleep)

    window_days = int(opts.get("window_days") or config.get("window", {}).get("days", 90))
    after = window_start(run_date, window_days)
    orders = list(opts.get("orders") or config.get("search", {}).get("orders") or ["viewCount"])
    for order in orders:
        if order not in contracts.SEARCH_ORDERS:
            raise UsageError(f"order {order!r} is not one of {', '.join(contracts.SEARCH_ORDERS)}")
    pages = int(opts.get("pages") or config.get("search", {}).get("pages", 1))
    queries = _select_queries(config, opts.get("only"), opts.get("langs"))
    if not queries:
        raise UsageError("no query matches --only / --langs")
    languages = config.get("languages", {})

    # 1. search -------------------------------------------------------------------------------------------------
    found, rows, fatal = {}, [], None
    for q in queries:
        lang_cfg = languages[q["lang"]]
        for order in orders:
            row = {"id": q["id"], "niche": q["niche"], "lang": q["lang"], "order": order, "q": q["q"], "videos": 0, "status": "ok"}
            rows.append(row)
            if fatal:
                row["status"] = "skipped (run stopped)"
                continue
            if not budget.affordable("search.list"):
                row["status"] = "skipped: " + ("quota exhausted" if "search" in budget.exhausted else "search cap reached")
                continue
            try:
                res = client.search(q["q"], after, order=order, relevance_language=lang_cfg.get("relevanceLanguage"),
                                    region_code=lang_cfg.get("regionCode"), pages=pages, safe_search=config.get("search", {}).get("safeSearch"))
            except BudgetExceeded as err:
                row["status"] = "skipped: " + ("quota exhausted" if err.reason == "exhausted" else "search cap reached")
                continue
            except ApiError as err:
                if err.kind in ("auth", "blocked"):
                    fatal = err
                    row["status"] = f"failed: {err.kind}"
                    continue
                client._record(err, f"search {q['id']} ({order})")
                row["status"] = "quotaExceeded" if err.kind == "quota" else f"error: {err.kind}"
                continue
            row["videos"] = len(res["ids"])
            row["pages"] = res["pages"]
            if res["nonVideo"]:
                row["nonVideoFiltered"] = res["nonVideo"]
            for vid in res["ids"]:
                entry = found.setdefault(vid, {"queries": [], "lang": q["lang"], "niches": []})
                if q["id"] not in entry["queries"]:
                    entry["queries"].append(q["id"])
                if q["niche"] not in entry["niches"]:
                    entry["niches"].append(q["niche"])
    if fatal:
        raise RunFailed(f"YouTube refused the request ({fatal}). Check {contracts.KEY_ENV}, that the YouTube Data API v3 is enabled for the key's project, the key's API restrictions, and that the network allows youtube.googleapis.com.")
    if mode == "live" and not any(r["status"] == "ok" for r in rows):
        raise RunFailed("no search succeeded; nothing to rank (see the query statuses)")
    log(f"search: {sum(1 for r in rows if r['status'] == 'ok')}/{len(rows)} queries answered, {len(found)} distinct videos")

    # 2. statistics ---------------------------------------------------------------------------------------------
    try:
        videos = client.videos(list(found), detail="full")
    except ApiError as err:
        raise RunFailed(f"videos.list failed: {err}") from None
    rejected = {}

    def reject(reason):
        rejected[reason] = rejected.get(reason, 0) + 1

    own = {c.get("id") for c in config.get("ownChannels", []) if isinstance(c, dict)}
    excluded = set(config.get("excludeChannelIds") or [])
    floors = config.get("floors", {})
    fmt_cfg = config.get("format", {})
    candidates = []
    for vid, meta in found.items():
        v = videos.get(vid)
        if not v:
            reject("no-statistics")
            continue
        if v.get("liveBroadcastContent") in ("live", "upcoming"):
            reject("live-or-upcoming")
            continue
        if v.get("channelId") in own:
            reject("own-channel")
            continue
        if v.get("channelId") in excluded:
            reject("excluded-channel")
            continue
        pub = text.parse_time(v.get("publishedAt"))
        if pub is None or pub < after:
            reject("outside-window")
            continue
        if v.get("views") is None:
            reject("no-statistics")
            continue
        cls = classify.classify_video(v, taxonomy, fmt_cfg, meta["lang"])
        if cls["exclude"]:
            reject(cls["exclude"])
            continue
        fmt = cls["format"]
        floor_table = (floors.get("minViews") or {}).get(fmt, {})
        floor_lang = _floor_lang(cls["lang"], floor_table)
        if v["views"] < floor_table.get(floor_lang, 0):
            reject("below-floor")
            continue
        lang_weight = languages.get(cls["lang"], languages.get(meta["lang"], {})).get("weight", 1.0)
        fit_options = taxonomy.choose_fit(cls["topic"], cls["cues"], lang_weight)
        if not fit_options:
            reject("no-fit")
            continue
        candidates.append({
            "videoId": vid,
            "url": contracts.WATCH_URL.format(id=vid),
            "title": v.get("title") or "",
            "description": v.get("description") or "",
            "channelId": v.get("channelId"),
            "channelTitle": v.get("channelTitle") or "",
            "channelUrl": contracts.CHANNEL_URL.format(id=v.get("channelId")),
            "publishedAt": v.get("publishedAt"),
            "ageDays": round(text.days_between(pub, now), 2),
            "durationSec": v.get("durationSec"),
            "format": fmt,
            "formatAssumed": cls["formatAssumed"],
            "aspect": cls["aspect"],
            "lang": cls["lang"],
            "langSource": cls["langSource"],
            "views": v["views"],
            "likes": v.get("likes"),
            "comments": v.get("comments"),
            "queries": meta["queries"],
            "niches": meta["niches"],
            "classification": cls,
            "topic": cls["topic"],
            "subtopic": cls["subtopic"],
            "fitOptions": fit_options,
            "fit": fit_options[0],
            "fetchedAt": text.rfc3339(now),
        })
    log(f"filters: {len(candidates)} candidates from {len(found)} videos")

    # 3. channels -----------------------------------------------------------------------------------------------
    channel_ids = sorted({c["channelId"] for c in candidates if c.get("channelId")})
    try:
        channels = client.channels(channel_ids)
    except ApiError as err:
        raise RunFailed(f"channels.list failed: {err}") from None

    # 4. baselines, best pre-score first ------------------------------------------------------------------------
    by_channel = {}
    for c in candidates:
        by_channel.setdefault(c["channelId"], []).append(c)
    base_floors = floors.get("baselineFloor", {})

    def prescore(cid):
        best = 0.0
        for c in by_channel[cid]:
            est, _note = baseline_mod.lifetime_estimate(channels.get(cid), c["views"])
            best = max(best, c["views"] / max(est or 0.0, float(base_floors.get(c["format"], 1000)), 1.0))
        return best

    order = sorted(by_channel, key=lambda cid: (-prescore(cid), cid))
    bcfg = config.get("baseline", {})
    upload_pages = max(1, int(bcfg.get("uploadsPages", 1)))
    unfetched = 0
    for cid in order:
        ch = channels.get(cid)
        uploads, note = None, None
        if not ch:
            note = "the channel was not returned by channels.list"
        elif not ch.get("uploadsPlaylistId"):
            note = "the channel has no uploads playlist"
        elif not budget.affordable_all([("playlistItems.list", upload_pages), ("videos.list", upload_pages)]):
            note = "baseline not fetched: this run's unit cap was reached"
            unfetched += 1
        else:
            try:
                items = client.uploads(ch["uploadsPlaylistId"], pages=upload_pages)
                if items is None:
                    note = "the uploads playlist could not be read"
                else:
                    recs = client.videos([i["videoId"] for i in items], detail="baseline")
                    uploads = [dict(recs[i["videoId"]], publishedAt=recs[i["videoId"]].get("publishedAt") or i.get("videoPublishedAt")) for i in items if i["videoId"] in recs]
                    if not uploads and items:
                        note = "baseline not fetched: this run's unit cap was reached"
                        uploads = None
                        unfetched += 1
            except BudgetExceeded:
                note = "baseline not fetched: this run's unit cap was reached"
                unfetched += 1
            except ApiError as err:
                if err.kind in ("auth", "blocked"):
                    raise RunFailed(f"baseline for {cid} failed: {err}") from None
                client._record(err, f"baseline for channel {cid}")
                note = f"the uploads could not be read ({err.kind})"
        for c in by_channel[cid]:
            c["baseline"] = baseline_mod.compute(c, uploads, ch, now, bcfg, fmt_cfg, uploads_note=note)
    if unfetched:
        warnings.append(f"Baselines for {unfetched} channel(s) were estimated because this run's unit cap was reached; raise --max-units for exact medians.")

    # 5. scoring ------------------------------------------------------------------------------------------------
    sc = config.get("scoring", {})
    min_outlier = float(floors.get("minOutlier", 3.0))
    qualified = []
    for c in candidates:
        b = c["baseline"]
        floor = float(base_floors.get(c["format"], 1000))
        ratio, floor_applied = score.outlier_ratio(c["views"], b.get("median"), floor)
        c["floor"] = int(floor)
        c["outlier"] = ratio
        c["floorApplied"] = floor_applied
        flags = list(b.get("flags", []))
        if floor_applied:
            flags.append("floor-applied")
        if c["formatAssumed"]:
            flags.append("format-assumed")
        if c["ageDays"] < float(sc.get("youngDays", 3)):
            flags.append("young-video")
        c["flags"] = sorted(set(flags))
        c["engagementRate"] = score.engagement_rate(c["likes"], c["comments"], c["views"])
        if ratio is None or ratio < min_outlier:
            reject("not-outlier")
            continue
        qualified.append(c)
    refs = score.median_rates(qualified)
    weights = sc.get("weights", {"outlier": 0.45, "recency": 0.2, "engagement": 0.15, "fit": 0.2})
    for c in qualified:
        c["engagementReference"] = refs.get(c["format"])
        c["components"] = {
            "outlier": round(score.outlier_component(c["outlier"], float(sc.get("outlierSaturation", 32))), 4),
            "recency": round(score.recency_component(c["ageDays"], float(sc.get("recencyHalfLifeDays", 30))), 4),
            "engagement": round(score.engagement_component(c["engagementRate"], c["engagementReference"]), 4),
            "fit": round(c["fit"]["fit"], 4),
        }
        c["confidence"] = round(score.confidence(c["flags"], sc.get("confidence", {})), 4)
        c["score"] = score.rank(c["components"], weights, c["confidence"])
        c["why"] = report.why_sentence(c)
    log(f"scoring: {len(qualified)} outliers (ratio >= {min_outlier:g})")

    # 6. ideas and outputs --------------------------------------------------------------------------------------
    builder = ideas_mod.IdeaBuilder(taxonomy, config, ctx["backlogs"], ctx["evergreen"], ctx["names"])
    all_ideas = builder.build(qualified)
    top = int(opts.get("top") or config.get("output", {}).get("top", 25))
    listed = [i for i in all_ideas if i["backlog"]["status"] != "duplicate"][:top]
    dups = [i for i in all_ideas if i["backlog"]["status"] == "duplicate"]
    expires_on = (run_date + dt.timedelta(days=int(retention))).isoformat()
    doc = {
        "version": 1,
        "tool": "scripts/topics (topic finder)",
        "runDate": run_date.isoformat(),
        "generatedAt": text.rfc3339(now),
        "fetchedAt": text.rfc3339(now),
        "mode": mode,
        "expiresOn": expires_on,
        "policy": {
            "retentionDays": int(retention),
            "derivedMetricsAmendment": (config.get("compliance") or {}).get("derivedMetricsAmendment", {}).get("accepted", False),
            "note": "YouTube values are API Data shown as returned; outlier ratios, scores and tags are the topic finder's own metrics.",
        },
        "window": {"days": window_days, "publishedAfter": text.rfc3339(after)},
        "settings": {"orders": orders, "pages": pages, "minOutlier": min_outlier, "floors": floors, "weights": weights},
        "quota": dict(budget.summary(), dailyLimits=dict(table.daily_limits), notes=cap_notes, ledgerToday={b: ledger.spent_today(b) for b in table.buckets()}, stopped=client.stopped),
        "cache": cache.stats(),
        "retention": {"prunedCacheEntries": pruned_cache, "prunedReports": pruned_reports},
        "queries": rows,
        "counts": {"videosFound": len(found), "videosRead": len(videos), "candidates": len(candidates), "outliers": len(qualified), "ideas": len(all_ideas), "listed": len(listed), "duplicates": len(dups)},
        "rejected": rejected,
        "ideas": [_serial(i) for i in listed + dups],
        "exports": {},
        "warnings": warnings,
        "errors": client.errors,
    }
    written = []
    os.makedirs(out_dir, exist_ok=True)
    dubs = config.get("output", {}).get("dubs", ["es", "pt-br"])
    md_display = _display_path(os.path.join(out_dir, f"{run_date.isoformat()}.md"), ctx["studio"])
    exports = export.build_exports(listed, sorted(ctx["formats"]), run_date, retention, int(opts.get("export_top") or config.get("output", {}).get("exportTopPerChannel", 10)), ctx["backlogs"], dubs, md_display)
    other_slugs = builder._existing_slugs()
    for channel, data in exports.items():
        problems = export.validate_backlog(data, ctx["formats"][channel], other_slugs)
        leaks = export.find_api_data_leaks(data)
        if leaks:
            problems.append(f"YouTube data found in idea fields: {', '.join(map(str, leaks))}")
        if problems:
            warnings.append(f"{channel} export failed validation and was not written: {'; '.join(problems)}")
            continue
        path = os.path.join(out_dir, f"{run_date.isoformat()}.backlog.{channel}.json")
        _write_json(path, data)
        written.append(path)
        info = {"path": _display_path(path, ctx["studio"]), "ideas": len(data["ideas"])}
        if opts.get("merge_preview"):
            merged = export.merge_preview(ctx["backlogs"].get(channel), data)
            others = set()
            for ch, b in ctx["backlogs"].items():
                if ch != channel and isinstance(b, dict):
                    others |= {x.get("slug") or x.get("id") for x in b.get("ideas", []) if isinstance(x, dict)}
            mp = export.validate_backlog(merged, ctx["formats"][channel], others)
            if mp:
                warnings.append(f"{channel} merged preview has problems: {'; '.join(mp)}")
            ppath = os.path.join(out_dir, f"{run_date.isoformat()}.merged.{channel}.json")
            _write_json(ppath, merged)
            written.append(ppath)
            info["preview"] = _display_path(ppath, ctx["studio"])
        doc["exports"][channel] = info
    json_path = os.path.join(out_dir, f"{run_date.isoformat()}.json")
    md_path = os.path.join(out_dir, f"{run_date.isoformat()}.md")
    _write_json(json_path, doc)
    with open(md_path + ".tmp", "w", encoding="utf-8") as fh:
        fh.write(report.render_markdown(doc))
    os.replace(md_path + ".tmp", md_path)
    written = [json_path, md_path] + written
    return doc, written


def _display_path(path, root):
    rel = os.path.relpath(path, root)
    return path if rel.startswith("..") else rel


def _serial(idea):
    out = dict(idea)
    out["key"] = list(idea["key"])
    out["evidence"] = [{k: v for k, v in e.items() if k not in ("description",)} for e in idea["evidence"]]
    return out


def _write_json(path, data):
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    os.replace(tmp, path)


def plan(config, table, opts):
    """Upper bounds of the calls a run makes, without calling the API."""
    queries = _select_queries(config, opts.get("only"), opts.get("langs"))
    orders = list(opts.get("orders") or config.get("search", {}).get("orders") or ["viewCount"])
    pages = int(opts.get("pages") or config.get("search", {}).get("pages", 1))
    searches = len(queries) * len(orders) * pages
    results = searches * contracts.MAX_PAGE_SIZE
    per_channel = int(config.get("baseline", {}).get("uploadsPages", 1)) * 2
    videos_calls = -(-results // contracts.MAX_IDS_PER_CALL)
    channel_calls = videos_calls
    max_units = int(opts.get("max_units", 2000))
    room = max(0, max_units - videos_calls - channel_calls)
    return {
        "queries": len(queries), "orders": orders, "pages": pages,
        "searchCalls": searches, "searchBucket": table.daily_limits.get("search"),
        "maxResults": results,
        "videosListCalls": videos_calls, "channelsListCalls": channel_calls,
        "unitsPerBaseline": per_channel,
        "baselinesWithinCap": room // per_channel if per_channel else 0,
        "maxUnits": max_units, "maxSearches": int(opts.get("max_searches", 30)),
    }
