#!/usr/bin/env python3
"""Topic finder CLI: YouTube outliers in our niches -> ranked, original video ideas (Python 3 standard library only).

    python3 scripts/topics/topics.py find --fixtures            # synthetic fixtures, no key, no network
    python3 scripts/topics/topics.py plan                       # what a live run would call, and its quota bounds
    YOUTUBE_API_KEY=... python3 scripts/topics/topics.py find   # live (needs the owner's go-ahead, see README)
    python3 scripts/topics/topics.py prune                      # delete cached YouTube data older than 30 days
    python3 scripts/topics/topics.py quota                      # units this tool charged today (Pacific Time)

Exit codes: 0 done (possibly partial; see the report), 1 the run failed, 2 bad input, 3 blocked (policy or key).
"""

import argparse
import datetime as dt
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from topiclib import cache as cache_mod  # noqa: E402
from topiclib import contracts, pipeline, quota  # noqa: E402


def _date(value):
    try:
        return dt.date.fromisoformat(value)
    except ValueError:
        raise argparse.ArgumentTypeError(f"not a YYYY-MM-DD date: {value!r}") from None


def _positive(value):
    try:
        n = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError(f"not a whole number: {value!r}") from None
    if n < 0:
        raise argparse.ArgumentTypeError("must be 0 or more")
    return n


def _csv(value):
    return [v.strip() for v in value.split(",") if v.strip()]


def _common(p):
    p.add_argument("--max-units", type=_positive, default=2000, help="most units this run may spend from the project's 10,000-a-day pool (videos.list, channels.list, playlistItems.list: 1 each). Default 2000")
    p.add_argument("--max-searches", type=_positive, default=30, help="most search.list calls this run may make (separate bucket: 100 a day per project, 1 per call or page). Default 30")
    p.add_argument("--only", type=_csv, help="query ids or niche names from config.json, comma-separated")
    p.add_argument("--langs", type=_csv, help="languages to search (en,es,pt)")
    p.add_argument("--orders", type=_csv, help="search orders (default from config.json: viewCount)")
    p.add_argument("--pages", type=int, help="search pages per query (50 results each; each page is one search call)")
    p.add_argument("--config", default=pipeline.DEFAULT_CONFIG)
    p.add_argument("--quota", default=pipeline.DEFAULT_QUOTA, help="quota cost table (quota.json)")
    p.add_argument("--taxonomy", default=pipeline.DEFAULT_TAXONOMY)


def main(argv=None):
    parser = argparse.ArgumentParser(prog="topics.py", description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)

    find = sub.add_parser("find", help="search, score and write out/topics/<date>.md, .json and backlog exports")
    _common(find)
    find.add_argument("--fixtures", nargs="?", const=pipeline.DEFAULT_FIXTURES, default=None, metavar="DIR",
                      help="answer from the fixture database instead of YouTube (default dir scripts/topics/fixtures/api)")
    find.add_argument("--date", type=_date, help="run date (default: today in America/Chicago; fixture runs default to the fixtures' date)")
    find.add_argument("--out-dir", help="output directory (default out/topics, or out/topics/fixtures for fixture runs)")
    find.add_argument("--cache-dir", help="cache directory (default .cache/topics for live runs; fixture runs use no cache unless given)")
    find.add_argument("--no-cache", action="store_true", help="neither read nor write the cache")
    find.add_argument("--refresh", action="store_true", help="ignore cached answers (still writes fresh ones)")
    find.add_argument("--ledger", help="quota ledger file (default .cache/topics-ledger.json for live runs)")
    find.add_argument("--top", type=int, help="ideas listed in the report (default 25)")
    find.add_argument("--export-top", type=int, help="ideas exported per channel (default 10)")
    find.add_argument("--merge-preview", action="store_true", help="also write each channel's backlog with the candidates appended (a preview file)")
    find.add_argument("--key-in-query", action="store_true", help="send the API key as the key query parameter instead of the x-goog-api-key header")
    find.add_argument("--retention-days", type=float, help="delete reports and cache older than this (at most 30)")
    find.add_argument("--quiet", action="store_true")

    pl = sub.add_parser("plan", help="show the calls and quota bounds of a run without calling the API")
    _common(pl)

    pr = sub.add_parser("prune", help="delete cached YouTube data and reports older than the retention period")
    pr.add_argument("--out-dir", default=pipeline.DEFAULT_OUT)
    pr.add_argument("--cache-dir", default=pipeline.DEFAULT_CACHE)
    pr.add_argument("--retention-days", type=float, default=30)

    qu = sub.add_parser("quota", help="units this tool charged today, per bucket (its own ledger)")
    qu.add_argument("--ledger", default=pipeline.DEFAULT_LEDGER)
    qu.add_argument("--quota", default=pipeline.DEFAULT_QUOTA)

    args = parser.parse_args(argv)
    if args.command == "find":
        return _find(args)
    if args.command == "plan":
        return _plan(args)
    if args.command == "prune":
        now = dt.datetime.now(dt.timezone.utc)
        n = cache_mod.prune_cache(args.cache_dir, now, args.retention_days)
        removed = cache_mod.prune_reports(args.out_dir, pipeline.today_in_owner_zone(now), args.retention_days)
        print(f"pruned {n} cache entr{'y' if n == 1 else 'ies'} and {len(removed)} report file(s) older than {cache_mod.clamp_days(args.retention_days):g} days")
        return 0
    if args.command == "quota":
        table = quota.QuotaTable.load(args.quota)
        ledger = quota.Ledger(args.ledger)
        print(f"today ({ledger.day_key()} Pacific Time), this tool's own ledger:")
        for bucket in table.buckets():
            print(f"  {bucket:<8} {ledger.spent_today(bucket):>6} of {table.daily_limits[bucket]:,} a day")
        return 0
    return 2


def _find(args):
    log = (lambda msg: None) if args.quiet else (lambda msg: print(msg, file=sys.stderr))
    opts = {
        "mode": "fixtures" if args.fixtures else "live",
        "api_key": os.environ.get(contracts.KEY_ENV, "").strip(),
        "key_in_query": args.key_in_query,
        "max_units": args.max_units,
        "max_searches": args.max_searches,
        "only": args.only,
        "langs": args.langs,
        "orders": args.orders,
        "pages": args.pages,
        "config_path": args.config,
        "quota_path": args.quota,
        "taxonomy_path": args.taxonomy,
        "top": args.top,
        "export_top": args.export_top,
        "merge_preview": args.merge_preview,
        "refresh": args.refresh,
        "log": log,
    }
    if args.fixtures:
        opts["fixtures_dir"] = args.fixtures
        try:
            with open(os.path.join(args.fixtures, "db.json"), encoding="utf-8") as fh:
                recorded = json.load(fh).get("recordedAt")
        except (OSError, ValueError) as err:
            print(f"topics: cannot read the fixture database: {err}", file=sys.stderr)
            return 2
        opts["now"] = dt.datetime.fromisoformat(recorded.replace("Z", "+00:00")) if recorded else None
    if args.date:
        opts["run_date"] = args.date
    if args.out_dir:
        opts["out_dir"] = args.out_dir
    if args.no_cache:
        opts["cache_dir"] = None
    elif args.cache_dir:
        opts["cache_dir"] = args.cache_dir
    if args.ledger:
        opts["ledger_path"] = args.ledger
    if args.retention_days is not None:
        opts["retention_days"] = args.retention_days
    try:
        doc, written = pipeline.run_find(opts)
    except pipeline.PolicyBlocked as err:
        print(f"topics: blocked: {err}", file=sys.stderr)
        return 3
    except pipeline.UsageError as err:
        print(f"topics: {err}", file=sys.stderr)
        return 2
    except pipeline.RunFailed as err:
        print(f"topics: failed: {err}", file=sys.stderr)
        return 1
    except OSError as err:
        print(f"topics: {err}", file=sys.stderr)
        return 1
    q = doc["quota"]
    c = doc["counts"]
    print(f"topics {doc['runDate']} ({doc['mode']}): {c['videosFound']} videos, {c['candidates']} candidates, {c['outliers']} outliers, "
          f"{c['listed']} new ideas, {c['duplicates']} matching existing backlog ideas")
    print(f"  quota: search.list {q['spent'].get('search', 0)}/{q['caps'].get('search', 0)} calls, other {q['spent'].get('default', 0)}/{q['caps'].get('default', 0)} units; cache hits {doc['cache']['hits']}")
    for idea in doc["ideas"][:5]:
        if idea.get("rank"):
            print(f"  {idea['rank']:>2}. [{idea['score']:5.1f}] {idea['channelName']} {idea['formatLabel']}: {idea['pitch']['workingTitle']}")
    for path in written:
        print(f"  wrote {os.path.relpath(path)}")
    for w in doc["warnings"]:
        print(f"  warning: {w}", file=sys.stderr)
    return 0


def _plan(args):
    try:
        ctx = pipeline.load_context(config_path=args.config, quota_path=args.quota, taxonomy_path=args.taxonomy)
        p = pipeline.plan(ctx["config"], ctx["quota"], {"only": args.only, "langs": args.langs, "orders": args.orders, "pages": args.pages, "max_units": args.max_units, "max_searches": args.max_searches})
    except pipeline.UsageError as err:
        print(f"topics: {err}", file=sys.stderr)
        return 2
    print(f"{p['queries']} queries x {len(p['orders'])} order(s) ({', '.join(p['orders'])}) x {p['pages']} page(s) = {p['searchCalls']} search.list calls "
          f"(cap {p['maxSearches']}; the project's Search Queries bucket allows {p['searchBucket']} a day)")
    print(f"up to {p['maxResults']} results -> at most {p['videosListCalls']} videos.list and {p['channelsListCalls']} channels.list units")
    print(f"each channel baseline costs {p['unitsPerBaseline']} units (uploads page + videos.list); about {p['baselinesWithinCap']} baselines fit in --max-units {p['maxUnits']}")
    print("a live run also needs YOUTUBE_API_KEY and the derived-metrics amendment recorded in config.json (see README)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
