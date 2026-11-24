"""Run all configured sources with per-source failure isolation, normalize, and store."""
from __future__ import annotations
import logging, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from common import db
from common.util import canonical_url, sha
from . import normalize as N
from .sources import FETCHERS, SourceBlocked

log = logging.getLogger("intel.ingest")


def _run_source(src: dict) -> tuple[dict, list[dict], str | None, int]:
    t0 = time.time()
    fn = FETCHERS.get(src["type"])
    if not fn:
        return src, [], f"unknown source type {src['type']}", 0
    try:
        items = fn(src)
        return src, items, None, int((time.time() - t0) * 1000)
    except SourceBlocked as e:
        return src, [], f"blocked/stale: {e}", int((time.time() - t0) * 1000)
    except Exception as e:  # noqa: BLE001 - isolation is the point
        return src, [], f"{type(e).__name__}: {str(e)[:300]}", int((time.time() - t0) * 1000)


def finalize(item: dict, matcher: N.EntityMatcher) -> dict:
    title, summary = item["title"], item.get("summary") or ""
    text = f"{title}. {summary}"
    if not item.get("category"):
        c = N.classify(title)
        item["category"] = c if c != "other" else N.classify(text)
    if not item.get("entity"):
        item["entity"] = matcher.match(title, summary)
    if item["category"] == "defi_exploit" and N.is_cex(item.get("entity")):
        item["category"] = "exchange_hack"
    item["entity_slug"] = N.entity_slug(item.get("entity"))
    if not item.get("chain"):
        item["chain"] = N.detect_chain(text)
    if item.get("loss_usd") is None and item["category"] not in ("regulatory", "exchange_notice", "vuln_advisory"):
        item["loss_usd"] = N.extract_loss(title) or N.extract_loss(text)
    if not item.get("status"):
        item["status"] = N.detect_status(text)
    key = item.pop("natural_key", None) or canonical_url(item.get("url") or title)
    item["id"] = sha(key)
    return item


def ingest(con, run_id: str, sources: list[dict], exposure: dict, seen_utc: str, workers: int = 8) -> list[dict]:
    results = []
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(_run_source, s) for s in sources if s.get("enabled", True)]
        for f in as_completed(futs):
            results.append(f.result())
    # incident DB first so its entity names feed the matcher and it anchors clusters
    results.sort(key=lambda r: (r[0]["type"] != "defillama_hacks", r[0]["name"]))
    extra = {i.get("entity") for _, items, _, _ in results for i in items if i.get("source_type") == "incident_db"}
    extra |= {r["entity"] for r in con.execute(
        "SELECT DISTINCT entity FROM items WHERE source_type='incident_db' AND entity IS NOT NULL")}
    matcher = N.EntityMatcher(exposure, sorted(x for x in extra if x))
    health = []
    for src, items, err, ms in results:
        n_new = 0
        for it in items:
            try:
                if db.upsert(con, finalize(it, matcher), seen_utc):
                    n_new += 1
            except Exception as e:  # one bad record must not kill the source
                log.warning("%s: bad record skipped (%s)", src["name"], e)
        con.execute("INSERT OR REPLACE INTO source_runs VALUES (?,?,?,?,?,?,?)",
                    (run_id, src["name"], int(err is None), len(items), n_new, err, ms))
        lvl = logging.INFO if err is None else logging.WARNING
        log.log(lvl, "source %-24s %s items=%d new=%d %dms %s", src["name"], "OK  " if err is None else "FAIL",
                len(items), n_new, ms, err or "")
        health.append({"source": src["name"], "ok": err is None, "items": len(items), "new": n_new,
                       "error": err, "ms": ms})
    con.commit()
    return sorted(health, key=lambda h: (not h["ok"], h["source"]))
