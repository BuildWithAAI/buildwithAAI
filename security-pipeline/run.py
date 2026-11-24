#!/usr/bin/env python3
"""Zoorped OPSEC & threat-intel pipeline: ingest -> score -> wallet audit -> digest + alerts.

Examples:
  .venv/bin/python run.py                       # last 24h, WATCH and above
  .venv/bin/python run.py --since 7d --tier HIGH
  .venv/bin/python run.py --no-ingest --since 30d   # re-score / re-report from the local DB only
Safe for cron/systemd: single-instance lock, idempotent upserts, atomic output writes, per-source isolation.
"""
from __future__ import annotations
import argparse, fcntl, json, logging, os, sys
from collections import Counter, defaultdict
from datetime import timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from common import config, db, logs  # noqa: E402
from common.util import iso, now_utc, parse_duration, parse_time  # noqa: E402
from intel.ingest import ingest  # noqa: E402
from scoring.score import ACTIONS, TIER_RANK, TIERS, score_all  # noqa: E402

log = logging.getLogger("run")
OUT = ROOT / "out"
CT = ZoneInfo("America/Chicago")


def atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text)
    os.replace(tmp, path)


def build_clusters(con, cutoff, now, min_tier: str | None = None) -> list[dict]:
    rows = [dict(r) for r in con.execute(
        "SELECT * FROM items WHERE tier IS NOT NULL AND (time_utc >= ? OR (first_seen_utc >= ? AND time_utc >= ?))",
        (iso(cutoff), iso(cutoff), iso(cutoff - timedelta(hours=72))))]
    groups = defaultdict(list)
    for r in rows:
        groups[r["cluster_id"]].append(r)
    # pull sibling items of the same cluster outside the window, for source/loss context
    out = []
    for cid, items in groups.items():
        allit = [dict(r) for r in con.execute("SELECT * FROM items WHERE cluster_id=?", (cid,))]
        inc = [i for i in allit if i["source_type"] == "incident_db"]
        rep = inc[0] if inc else max(allit, key=lambda i: (i["severity"] or 0))
        best_tier = min((i["tier"] for i in items if i["tier"]), key=lambda t: TIER_RANK[t])
        if min_tier and TIER_RANK[best_tier] > TIER_RANK[min_tier]:
            continue
        cats = Counter(i["category"] for i in allit if i["category"] not in (None, "other"))
        cat = rep["category"] if inc else (cats.most_common(1)[0][0] if cats else rep["category"])
        loss = inc[0]["loss_usd"] if inc and inc[0]["loss_usd"] else max((i["loss_usd"] or 0 for i in allit), default=0) or None
        srcs = sorted({s for i in allit for s in json.loads(i["sources"])})
        links, seen = [], set()
        for i in sorted(allit, key=lambda i: (i["source_type"] != "incident_db", i["source_type"] == "news_search", i["time_utc"])):
            if i["url"] and i["url"] not in seen and "defillama.com/hacks" not in i["url"]:
                links.append({"title": i["title"], "url": clean_url(i["url"]), "source": i["source"]}); seen.add(i["url"])
        times = sorted(i["time_utc"] for i in allit)
        out.append({
            "cluster_id": cid, "tier": best_tier, "title": rep["title"], "entity": rep["entity"],
            "category": cat, "chain": rep["chain"], "loss_usd": loss, "status": rep["status"],
            "first_seen_event_utc": times[0], "latest_utc": times[-1],
            "severity": max(i["severity"] or 0 for i in allit), "relevance": max(i["relevance"] or 0 for i in allit),
            "reasons": json.loads(max(allit, key=lambda i: i["severity"] or 0)["reasons"] or "[]"),
            "matched_exposure": sorted({m for i in allit for m in json.loads(i["matched"] or "[]")}),
            "n_items": len(allit), "sources": srcs, "links": links[:6],
            "summary": (rep["summary"] or "")[:600],
            "action": ACTIONS.get(cat) if TIER_RANK[best_tier] <= 1 else None,
        })
    out.sort(key=lambda c: (TIER_RANK[c["tier"]], -c["severity"]))
    return out


def save_wallet_findings(con, findings: list[dict], now_s: str) -> None:
    from common.util import sha
    for f in findings:
        fid = sha(f"{f['chain']}|{f['address']}|{f['kind']}|{json.dumps(f.get('detail', {}).get('spender') or f['title'])}|{f.get('detail', {}).get('token')}")
        f["id"] = fid
        row = con.execute("SELECT first_seen_utc FROM wallet_findings WHERE id=?", (fid,)).fetchone()
        f["first_seen_utc"] = row["first_seen_utc"] if row else now_s
        f["new"] = row is None
        con.execute("INSERT OR REPLACE INTO wallet_findings VALUES (?,?,?,?,?,?,?,?,?,0)",
                    (fid, f["chain"], f["address"], f["kind"], f["tier"], f["title"], json.dumps(f.get("detail"), default=str),
                     f["first_seen_utc"], now_s))
    con.commit()


def fmt_loss(v):
    if not v:
        return "n/a"
    return f"${v/1e9:,.2f}B" if v >= 1e9 else f"${v/1e6:,.2f}M" if v >= 1e6 else f"${v/1e3:,.0f}K"


def clean_url(u: str) -> str:
    from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
    try:
        p = urlsplit(u)
        q = [(k, v) for k, v in parse_qsl(p.query) if not k.startswith("utm_") and k != "source"]
        return urlunsplit((p.scheme, p.netloc, p.path, urlencode(q), ""))
    except ValueError:
        return u


def md_link(l):
    t = l["title"].replace("|", "/").replace("[", "(").replace("]", ")")[:110]
    return f"[{t}]({clean_url(l['url'])})"


def best_link(con, cluster_id: str) -> str | None:
    rows = con.execute("SELECT url, source_type, time_utc FROM items WHERE cluster_id=? AND source_type!='incident_db' AND url IS NOT NULL "
                       "ORDER BY (source_type='news_search'), time_utc", (cluster_id,)).fetchall()
    return clean_url(rows[0]["url"]) if rows else None


def incidents(con, now, days: int, min_loss: float = 0) -> list[dict]:
    out = []
    for r in con.execute("SELECT * FROM items WHERE source_type='incident_db' AND time_utc>=? AND COALESCE(loss_usd,0)>=? ORDER BY time_utc DESC",
                         (iso(now - timedelta(days=days)), min_loss)):
        raw = json.loads(r["raw"] or "{}")
        out.append({"date": r["time_utc"][:10], "entity": r["entity"], "chain": r["chain"], "category": r["category"],
                    "loss_usd": r["loss_usd"], "technique": raw.get("technique"), "classification": raw.get("classification"),
                    "returned_usd": raw.get("returnedFunds"), "tier": r["tier"],
                    "defillama": "https://defillama.com/hacks", "report_link": best_link(con, r["cluster_id"])})
    return out


def render_digest(now, args, clusters, health, wallet_res, con) -> str:
    L = []
    now_ct = now.astimezone(CT)
    cnt = Counter(c["tier"] for c in clusters)
    L.append("# Zoorped OPSEC Digest")
    L.append(f"Generated {now_ct:%a %b %d %Y %I:%M %p} CT ({iso(now)}) | window: last {args.since} | min tier: {args.tier}")
    L.append("")
    L.append("**Alerts:** " + " | ".join(f"{t}: {cnt.get(t, 0)}" for t in TIERS if TIER_RANK[t] <= TIER_RANK[args.tier]))
    failed = [h for h in health if not h["ok"]]
    L.append(f"**Sources:** {sum(h['ok'] for h in health)}/{len(health)} OK" + (f"; failed: {', '.join(h['source'] for h in failed)}" if failed else ""))
    wf = wallet_res.get("findings", [])
    L.append(f"**Wallets:** {wallet_res.get('addresses_configured', 0)} configured; findings: " +
             (", ".join(f"{k} {v}" for k, v in Counter(f['tier'] for f in wf).items()) or "none"))
    L.append("")
    for t in TIERS:
        cs = [c for c in clusters if c["tier"] == t]
        if not cs or TIER_RANK[t] > TIER_RANK[args.tier]:
            continue
        L.append(f"## {t} ({len(cs)})")
        for c in cs[: (50 if TIER_RANK[t] <= 1 else 30)]:
            L.append(f"- **{c['title']}** | {c['entity'] or 'n/a'} | {c['category']} | {c['chain'] or 'n/a'} | loss {fmt_loss(c['loss_usd'])} | "
                     f"sev {c['severity']:.0f} rel {c['relevance']:.2f} | {c['first_seen_event_utc'][:10]} | {c['n_items']} reports / {len(c['sources'])} sources"
                     + (f" | status: {c['status']}" if c['status'] else ""))
            if c["matched_exposure"]:
                L.append(f"  - Exposure: {', '.join(c['matched_exposure'])}")
            if c["action"]:
                L.append(f"  - Action: {c['action']}")
            for l in c["links"][:3]:
                L.append(f"  - {md_link(l)} ({l['source']})")
        L.append("")
    # exposure watch (30d)
    L.append("## Your exposure: last 30 days")
    since30 = iso(now - timedelta(days=30))
    for e in config.exposure().get("entities", []):
        rows = [dict(r) for r in con.execute(
            "SELECT title,url,time_utc,tier,source FROM items WHERE time_utc>=? AND matched LIKE ? AND tier IN ('CRITICAL','HIGH','WATCH') "
            "ORDER BY severity DESC LIMIT 3", (since30, f'%"{e["name"]}"%'))]
        n = con.execute("SELECT COUNT(*) FROM items WHERE time_utc>=? AND matched LIKE ?", (since30, f'%"{e["name"]}"%')).fetchone()[0]
        L.append(f"- **{e['name']}**: {n} related items" + ("" if rows else " (none at WATCH+)"))
        for r in rows:
            L.append(f"  - [{r['tier']}] {r['time_utc'][:10]} {md_link(r)}")
    L.append("")
    # incidents table
    L.append(f"## Major incidents (DeFiLlama, loss >= $1M, last {args.incident_days} days)")
    L.append("| Date | Entity | Chain | Category | Loss | Source |")
    L.append("|---|---|---|---|---|---|")
    for r in incidents(con, now, args.incident_days, 1e6):
        link = f"[report]({r['report_link']})" if r["report_link"] else "[DeFiLlama](https://defillama.com/hacks)"
        L.append(f"| {r['date']} | {r['entity']} | {(r['chain'] or '')[:40]} | {r['category']} | {fmt_loss(r['loss_usd'])} | {link} |")
    by = Counter()
    for r in con.execute("SELECT category, SUM(loss_usd) s FROM items WHERE source_type='incident_db' AND time_utc>=? GROUP BY category",
                         (iso(now - timedelta(days=args.incident_days)),)):
        by[r["category"]] = r["s"] or 0
    L.append("")
    L.append("**Loss by category:** " + " | ".join(f"{k}: {fmt_loss(v)}" for k, v in by.most_common()))
    L.append("")
    L.append("## Wallet monitoring")
    if wallet_res.get("note"):
        L.append(wallet_res["note"])
    for f in wf[:40]:
        L.append(f"- [{f['tier']}] {f['title']}" + (" (NEW)" if f.get("new") else ""))
    for e in wallet_res.get("errors", []):
        L.append(f"- error: {e}")
    L.append("")
    L.append("## Source health")
    L.append("| Source | Status | Items | New | ms | Error |")
    L.append("|---|---|---|---|---|---|")
    for h in health:
        L.append(f"| {h['source']} | {'OK' if h['ok'] else 'FAIL'} | {h['items']} | {h['new']} | {h['ms']} | {(h['error'] or '').replace('|', '/')[:120]} |")
    L.append("")
    L.append("_Automated triage. Severity/relevance are rule-based; verify via official channels before acting. "
             "This pipeline never handles private keys, seed phrases, passwords or API secrets._")
    return "\n".join(L) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--since", default="24h", help="alert window, e.g. 6h, 24h, 7d (default 24h)")
    ap.add_argument("--tier", default="WATCH", choices=TIERS, help="minimum tier to include (default WATCH)")
    ap.add_argument("--incident-days", type=int, default=90, help="window for the incidents table (default 90)")
    ap.add_argument("--no-ingest", action="store_true", help="skip network ingestion; re-score/report from DB")
    ap.add_argument("--no-wallets", action="store_true", help="skip wallet audit")
    ap.add_argument("--sources", help="comma list of source names to run (default all enabled)")
    ap.add_argument("--exit-code-on-critical", action="store_true", help="exit 2 if any CRITICAL alert (for schedulers)")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()
    logs.setup(args.verbose)
    window = parse_duration(args.since)

    lock_path = ROOT / "data" / "run.lock"
    lock_path.parent.mkdir(exist_ok=True)
    lock = open(lock_path, "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        log.warning("another run is in progress; exiting cleanly")
        return 0

    now = now_utc().replace(microsecond=0)
    run_id = now.strftime("%Y%m%dT%H%M%SZ")
    con = db.connect()
    con.execute("INSERT OR REPLACE INTO runs (run_id, started_utc, args) VALUES (?,?,?)", (run_id, iso(now), json.dumps(vars(args))))
    exposure = config.exposure()
    srcs = config.sources()["sources"]
    if args.sources:
        want = set(args.sources.split(","))
        srcs = [s for s in srcs if s["name"] in want]
    health = []
    if not args.no_ingest:
        health = ingest(con, run_id, srcs, exposure, iso(now))
    else:
        last = con.execute("SELECT run_id FROM source_runs ORDER BY run_id DESC LIMIT 1").fetchone()
        if last:
            health = [{"source": r["source"], "ok": bool(r["ok"]), "items": r["n_items"], "new": r["n_new"], "error": r["error"],
                       "ms": r["duration_ms"]} for r in con.execute("SELECT * FROM source_runs WHERE run_id=?", (last["run_id"],))]
    n = score_all(con, exposure, lookback_days=max(120, args.incident_days + 30))
    log.info("scored %d items", n)

    wallet_res = {"addresses_configured": 0, "findings": [], "errors": [], "note": "wallet audit skipped (--no-wallets)"}
    if not args.no_wallets:
        try:
            from wallets.check import run as wallet_run
            wallet_res = wallet_run(exposure)
            save_wallet_findings(con, wallet_res["findings"], iso(now))
        except SystemExit as e:  # secret-guard refusal
            wallet_res = {"addresses_configured": 0, "findings": [], "errors": [str(e)]}
        except Exception as e:
            log.exception("wallet audit failed")
            wallet_res["errors"] = [f"wallet audit failed: {e}"]

    clusters = build_clusters(con, now - window, now, args.tier)
    # wallet findings become alerts too
    wallet_alerts = [{"tier": f["tier"], "title": f["title"], "category": "wallet_" + f["kind"], "chain": f["chain"],
                      "address": f["address"], "detail": f.get("detail"), "new": f.get("new")}
                     for f in wallet_res.get("findings", []) if TIER_RANK.get(f["tier"], 9) <= TIER_RANK[args.tier]]
    payload = {
        "generated_utc": iso(now), "generated_local": now.astimezone(CT).isoformat(), "run_id": run_id,
        "window": args.since, "min_tier": args.tier,
        "counts": dict(Counter(c["tier"] for c in clusters) + Counter(w["tier"] for w in wallet_alerts)),
        "alerts": clusters, "wallet_alerts": wallet_alerts,
        "wallets": {k: v for k, v in wallet_res.items() if k != "findings"},
        "sources": health, "failed_sources": [h["source"] for h in health if not h["ok"]],
    }
    atomic_write(OUT / "alerts_latest.json", json.dumps(payload, indent=2, default=str))
    digest = render_digest(now, args, clusters, health, wallet_res, con)
    atomic_write(OUT / "digest_latest.md", digest)
    atomic_write(OUT / "incidents_latest.json", json.dumps(incidents(con, now, args.incident_days), indent=2, default=str))
    arch = OUT / "archive"
    atomic_write(arch / f"alerts_{run_id}.json", json.dumps(payload, default=str))
    for old in sorted(arch.glob("alerts_*.json"))[:-200]:
        old.unlink()
    con.execute("UPDATE runs SET finished_utc=?, summary=? WHERE run_id=?",
                (iso(now_utc()), json.dumps({"counts": payload["counts"], "failed": payload["failed_sources"]}), run_id))
    con.commit()
    log.info("done: %s | failed sources: %s | wrote %s", payload["counts"], payload["failed_sources"] or "none", OUT / "digest_latest.md")
    if args.exit_code_on_critical and payload["counts"].get("CRITICAL"):
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
