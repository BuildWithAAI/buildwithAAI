#!/usr/bin/env python3
"""News radar CLI (Python 3 standard library only).

    python3 scripts/radar/radar.py collect --date 2026-11-24
    python3 scripts/radar/radar.py collect --date 2026-11-24 --offline-fixtures

Live runs write content/zoora-security/radar/<date>.json and <date>.md and keep a
polite cache in .cache/radar/ (gitignored). Offline runs read
scripts/radar/fixtures/ and write to .cache/radar/offline-out/ unless --out-dir is
given, so fixture output never overwrites a real brief.
"""

import argparse
import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from radarlib import pipeline  # noqa: E402


def _date(text):
    try:
        return dt.date.fromisoformat(text)
    except ValueError:
        raise argparse.ArgumentTypeError(f"not a YYYY-MM-DD date: {text!r}") from None


def main(argv=None):
    parser = argparse.ArgumentParser(prog="radar.py", description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    collect = sub.add_parser("collect", help="fetch, cluster, rank and write the daily brief")
    collect.add_argument("--date", type=_date, default=dt.datetime.now(dt.timezone.utc).date(),
                         help="run date (UTC), default today")
    collect.add_argument("--offline-fixtures", action="store_true",
                         help="read scripts/radar/fixtures/ instead of the network")
    collect.add_argument("--out-dir", help="output directory (default: content/zoora-security/radar)")
    collect.add_argument("--cache-dir", default=pipeline.DEFAULT_CACHE, help="cache directory (gitignored)")
    collect.add_argument("--no-cache", action="store_true", help="do not read or write the cache")
    collect.add_argument("--fixtures-dir", default=pipeline.DEFAULT_FIXTURES)
    collect.add_argument("--history-dir", help="previous radar outputs (default: the output directory)")
    collect.add_argument("--sources", default=pipeline.DEFAULT_SOURCES, help="sources.json path")
    collect.add_argument("--window-days", type=int, default=3, help="fresh window in days, ending on --date")
    collect.add_argument("--lookback-days", type=int, default=14, help="history and novelty window")
    collect.add_argument("--max-age-days", type=int, default=120, help="oldest incident a follow-up can attach to")
    collect.add_argument("--only", help="comma-separated source ids")
    collect.add_argument("--user-agent", help="override the User-Agent (default from sources.json or RADAR_USER_AGENT)")
    collect.add_argument("--quiet", action="store_true")
    args = parser.parse_args(argv)

    log = (lambda msg: None) if args.quiet else (lambda msg: print(msg, file=sys.stderr))
    if args.window_days < 1 or args.lookback_days < 1 or args.max_age_days < args.window_days:
        parser.error("window, lookback and max-age must be positive and max-age >= window")
    only = {s.strip() for s in args.only.split(",")} if args.only else None
    try:
        doc, json_path, md_path = pipeline.run_collect(
            args.date,
            offline=args.offline_fixtures,
            out_dir=args.out_dir,
            cache_dir=None if args.no_cache else args.cache_dir,
            sources_path=args.sources,
            fixtures_dir=args.fixtures_dir,
            history_dir=args.history_dir,
            window_days=args.window_days,
            lookback_days=args.lookback_days,
            max_age_days=args.max_age_days,
            user_agent=args.user_agent,
            only=only,
            log=log,
        )
    except (OSError, ValueError) as err:
        print(f"radar: {err}", file=sys.stderr)
        return 2
    counts = doc["counts"]
    print(f"radar {doc['runDate']} ({doc['mode']}): {counts['sourcesOk']}/{counts['sourcesTotal']} sources ok, "
          f"{counts['items']} items, {counts['securityRelevant']} security-relevant, "
          f"{counts['candidates']} candidate incidents")
    for row in doc["sources"]:
        print(f"  {row['id']:<18} {row['tier']} {str(row['status']):<13} items={row['items']:<4} "
              f"relevant={row['relevant']:<3} {('; '.join(row['warnings'][:1]))[:90]}")
    for rank, inc in enumerate(doc["top"], 1):
        print(f"  #{rank} {inc['score']['total']:>5}  {inc['status']:<10} {inc['title']}")
    print(f"wrote {json_path}\nwrote {md_path}")
    if counts["sourcesOk"] == 0:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
