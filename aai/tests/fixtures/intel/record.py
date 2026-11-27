"""Re-record the intel adapter fixtures from the live sources (network; run by hand, never by pytest):
    .venv/bin/python tests/fixtures/intel/record.py
Large responses are trimmed so fixtures stay small; values are real, unmodified source data."""
import json, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from aai.intel.core import Fetcher
from aai.intel.feeds import registry
from tests.intel_replay import RAW, fname, key

WATCH = ["AAPL", "TSLA", "MSTR"]


def trim(url, body):
    if "company_tickers" in url and isinstance(body, dict):
        return {k: v for k, v in body.items() if str(v.get("ticker")).upper() in WATCH}
    if "data.sec.gov/submissions" in url and isinstance(body, dict):
        r = body["filings"]["recent"]
        n = 60
        body = {"cik": body.get("cik"), "name": body.get("name"), "filings": {"recent": {k: v[:n] for k, v in r.items()}}}
        return body
    if "api/xbrl/companyfacts" in url and isinstance(body, dict):   # keep only the tags the fundamentals adapter reads
        from aai.intel.adapters.xbrl import BANK_TAGS, CONCEPTS, SHARES, SHARES_FALLBACK
        keep = {c for cs in CONCEPTS.values() for c in cs} | {SHARES_FALLBACK, *BANK_TAGS}
        def recent(c):
            return {**c, "units": {u: [x for x in xs if str(x.get("end", "")) >= "2023-01-01"] for u, xs in c.get("units", {}).items()}}
        f = body.get("facts") or {}
        return {"cik": body.get("cik"), "entityName": body.get("entityName"),
                "facts": {"us-gaap": {k: recent(v) for k, v in (f.get("us-gaap") or {}).items() if k in keep},
                          "dei": {k: recent(v) for k, v in (f.get("dei") or {}).items() if k == SHARES}}}
    if "get_book_summary_by_currency" in url and isinstance(body, dict):
        return {**body, "result": body["result"][:60]}
    if "stablecoins.llama.fi" in url and isinstance(body, dict):
        return {"peggedAssets": body["peggedAssets"][:8]}
    return body


class Rec(Fetcher):
    def get(self, url, params=None, as_="json", **kw):
        body = super().get(url, params=params, as_=as_, **kw)
        RAW.mkdir(parents=True, exist_ok=True)
        k = key(url, params)
        (RAW / fname(k)).write_text(json.dumps({"key": k, "recorded_at": time.time(), "as": as_, "body": trim(url, body)}))
        return body


if __name__ == "__main__":
    cfg = {"intel": {"watchlist": WATCH, "sec_contact": "zoora-aai-terminal@localhost"}}
    f = Rec()
    only = set(sys.argv[1:])   # e.g. `record.py fundamentals` re-records just that feed
    for n, feed in registry().items():
        if only and n not in only:
            continue
        try:
            feed.fn(f, cfg, None); print("recorded", n)
        except Exception as e:
            print("FAILED", n, e)
