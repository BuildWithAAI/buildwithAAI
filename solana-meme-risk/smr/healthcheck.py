"""python -m risk health [--quick] [--mint MINT] [--no-tests]

Output shape (stable, same as v0 samples/healthcheck.json):
  {"overall": "pass"|"fail", "provider": "helius"|"public-rpc", "checked_at": <unix>,
   "checks": [{"check": str, "pass": bool, "required": bool, "ms": int, "detail": any}, ...]}
Exit code 0 if every required check passes, else 1. v0 check names are kept; new checks are only added.
--quick skips the end-to-end score (as in v0); the offline pytest suite still runs (fast) unless --no-tests.
Read-only: no trading, no signing, no keys."""
from __future__ import annotations
import importlib, json, os, sqlite3, statistics, subprocess, sys, time
import requests

DEFAULT_MINT = "H2ZViwA4dwxHd3bctARCUDUqTwTqfVrbmKQMrwBmpump"  # BAWSAQ, pump.fun, ~17h old on 2026-11-09 (fallback only); was FOMO (BZGN4nDk...), YE (9fs2XDSX...), BOWIE (tUjDS64...)
# Free public RPC (publicnode, ~36h) silently truncates getSignaturesForAddress for older mints, so any fixed reference
# mint goes "0 early buyers" after ~1.5 days. With no --mint we pick a fresh, busy launch the paper trader already saw.
AUTO_MINT_AGE_H = (2.0, 24.0)


def pick_reference_mint(now=None):
    """Busiest recent launch (2-24h old) from paper.db or the live experiment100 scanner; falls back to DEFAULT_MINT."""
    now = time.time() if now is None else now
    for rel in ("data/paper.db", "data/experiment100/paper.db"):
        mint = _pick_from_db(os.path.join(ROOT, rel), now)
        if mint:
            return mint
    return DEFAULT_MINT


def _pick_from_db(path, now):
    lo, hi = now - AUTO_MINT_AGE_H[1] * 3600, now - AUTO_MINT_AGE_H[0] * 3600
    try:
        c = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
    except Exception:
        return None
    try:
        try:
            row = c.execute(
                "SELECT mint FROM launches WHERE created_at BETWEEN ? AND ? AND decision IS NOT NULL "
                "AND txs_first_5m >= 100 ORDER BY txs_first_5m DESC, created_at DESC LIMIT 1",
                (lo, hi),
            ).fetchone()
            if row and row[0]:
                return row[0]
        except Exception:
            pass
        try:
            row = c.execute(
                "SELECT mint FROM scanner_candidates WHERE age_h BETWEEN ? AND ? AND mint IS NOT NULL "
                "AND at > ? ORDER BY COALESCE(mcap, 0) DESC LIMIT 1",
                (AUTO_MINT_AGE_H[0], AUTO_MINT_AGE_H[1], now - 6 * 3600),
            ).fetchone()
            if row and row[0]:
                return row[0]
        except Exception:
            pass
    finally:
        c.close()
    return None
LEGACY_MODULES = ["config", "data_sources", "early_buyer_extractor", "batch_tracer", "cluster_extractor",
                  "data_extractors", "signal_extractor", "rug_detection_rules", "risk_score"]
PKG_MODULES = ["smr.config", "smr.cache", "smr.resilience", "smr.sources.rpc", "smr.sources.http", "smr.labels", "smr.chain",
               "smr.context", "smr.early_buyer_extractor", "smr.batch_tracer", "smr.cluster_extractor", "smr.data_extractors",
               "smr.signal_extractor", "smr.rug_detection_rules", "smr.risk_score", "smr.report", "smr.legacy", "smr.pipeline",
               "smr.watch", "smr.backtest.cli"]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _check(name, fn, required=True):
    t = time.time()
    try:
        r = fn()
        ok, detail = r if isinstance(r, tuple) else (True, r)
    except Exception as e:
        ok, detail = False, f"{type(e).__name__}: {e}"[:500]
    return {"check": name, "pass": bool(ok), "required": required, "ms": round((time.time() - t) * 1000), "detail": detail}


def _rpc_probe(ep):
    def f():
        lat, slot = [], None
        s = requests.Session()
        for _ in range(3):
            t = time.time()
            j = s.post(ep.url, json={"jsonrpc": "2.0", "id": 1, "method": "getSlot"}, timeout=15).json()
            lat.append(round((time.time() - t) * 1000))
            if "result" not in j:
                return False, {"endpoint": ep.name, "error": j.get("error"), "latency_ms": lat}
            slot = j["result"]
            time.sleep(max(0.05, 1 / ep.rps))
        return True, {"endpoint": ep.name, "url": ep.url.split("?")[0], "slot": slot, "latency_ms": lat, "median_ms": int(statistics.median(lat))}
    return f


def _http(src, path, expect=None, ttl=0):
    def f():
        j = src.get_json(path, ttl=ttl)
        ok = j is not None and (expect is None or (expect in j if isinstance(j, dict) else bool(j)))
        return ok, {"status": 200 if j is not None else "not_found/err", "url": src.base + path.split("api-key")[0]}
    return f


def run(mint=None, quick=False, tests=True):
    mint = mint or pick_reference_mint()
    from .context import Context
    from . import config as C
    ctx = Context()
    s = ctx.settings
    checks = []
    eps = s.endpoints
    checks.append(_check("rpc_reachable_latency", _rpc_probe(eps[0])))
    for ep in eps:
        checks.append(_check(f"rpc_endpoint:{ep.name}", _rpc_probe(ep), required=False))
    checks.append(_check("rpc_pool_failover", lambda: (ctx.rpc.call("getSlot", ttl=0) is not None, ctx.rpc.snapshot())))
    pf, ds, gt = ctx.pumpfun.h, ctx.dex.h, ctx.gt.h
    checks.append(_check("pumpfun_latest_coins", _http(pf, "/coins?offset=0&limit=1&sort=created_timestamp&order=DESC&includeNsfw=false")))
    checks.append(_check("pumpfun_coin_detail", _http(pf, f"/coins-v2/{mint}", "mint")))
    checks.append(_check("pumpfun_user_created_coins", _http(pf, "/coins-v2/user-created-coins/DbG7RyLFBWXpEWgfKUA8qByvBZEZ3chqGh9TLkpjpF3b?offset=0&limit=1&includeNsfw=true", "coins")))
    checks.append(_check("dexscreener_tokens", _http(ds, f"/latest/dex/tokens/{mint}", "pairs")))
    def solscan():
        r = requests.get("https://public-api.solscan.io/token/meta?tokenAddress=" + C.WSOL_MINT, headers={"User-Agent": s.http_ua}, timeout=20)
        return r.status_code == 200, {"status": r.status_code, "url": r.url}
    checks.append(_check("solscan_public_api (optional, not used)", solscan, required=False))
    checks.append(_check("geckoterminal_token_pools (optional)", _http(gt, f"/networks/solana/tokens/{C.WSOL_MINT}/pools", "data", ttl=3600), required=False))

    def graph_rw():
        g = ctx.graph
        with g.lock:
            g.db.execute("CREATE TABLE IF NOT EXISTS _health (ts REAL)"); g.db.execute("INSERT INTO _health VALUES (?)", (time.time(),))
            n = g.db.execute("SELECT COUNT(*) FROM _health").fetchone()[0]; g.db.execute("DELETE FROM _health"); g.db.commit()
            tabs = [r[0] for r in g.db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_%' ESCAPE '\\'")]
            counts = {t: g.db.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in tabs}
        return n >= 1, {"path": s.graph_db, "write_read": n >= 1, "row_counts": counts}
    checks.append(_check("funding_graph_db_rw", graph_rw))

    def cache_rw():
        k = "_health"; ctx.cache.set(k, {"t": 1}); ok = ctx.cache.get(k, None) == {"t": 1}
        n = sqlite3.connect(s.cache_db).execute("SELECT COUNT(*) FROM cache").fetchone()[0]
        return ok, {"path": s.cache_db, "rows": n, "mode": ctx.cache.mode}
    checks.append(_check("cache_db_rw", cache_rw))

    def anchors():
        with ctx.anchors.lock:
            n, lo, hi = ctx.anchors.db.execute("SELECT COUNT(*), MIN(block_time), MAX(block_time) FROM stream").fetchone()
        a = ctx.anchors.anchor_at(int(time.time()) - 180, max_pages=5)
        return a is not None, {"path": os.path.join(s.data_dir, "launches.db"), "rows": n, "covered_hours": round((hi - lo) / 3600, 1) if n else 0,
                               "anchor_3min_ago": bool(a)}
    checks.append(_check("anchor_index_db_rw", anchors))

    def labels():
        n = len(ctx.labels)
        return n > 0, {"path": s.labels_file, "verified_entities": n}
    checks.append(_check("labels_file", labels))

    def watch_db():
        p = os.path.join(s.data_dir, "watch", "scored_tokens.db")
        if not os.path.exists(p):
            return True, {"path": p, "exists": False}
        n = sqlite3.connect(p).execute("SELECT COUNT(*) FROM scored_tokens").fetchone()[0]
        return True, {"path": p, "scored_tokens_rows": n}
    checks.append(_check("watch_db", watch_db, required=False))

    sys.path.insert(0, ROOT)
    for m in LEGACY_MODULES:
        checks.append(_check(f"import:{m}", lambda m=m: (importlib.import_module(m) is not None, "ok")))
    for m in PKG_MODULES:
        checks.append(_check(f"import:{m}", lambda m=m: (importlib.import_module(m) is not None, "ok")))

    if tests:
        def pytest_quick():
            if not os.path.isdir(os.path.join(ROOT, "tests")):
                return False, "tests/ missing"
            r = subprocess.run([sys.executable, "-m", "pytest", "-q", "-m", "not network", "-p", "no:cacheprovider", "tests"],
                               cwd=ROOT, capture_output=True, text=True, timeout=600)
            tail = (r.stdout.strip().splitlines() or [""])[-1]
            return r.returncode == 0, {"returncode": r.returncode, "summary": tail}
        checks.append(_check("tests_quick", pytest_quick))

    if not quick:
        def e2e():
            from .pipeline import score_mint_legacy
            from . import report
            t = time.time()
            r = score_mint_legacy(mint, ctx=ctx, n_buyers=15, hops=1, trace_limit=8)
            report.validate(r["risk_report_v1"])
            ok = isinstance(r.get("score"), int) and r.get("recommendation") in ("SKIP", "REDUCED", "NORMAL") and len(r.get("early_buyers", [])) > 0
            return ok, {"mint": mint, "score": r.get("score"), "recommendation": r.get("recommendation"), "flags": r.get("flags"),
                        "early_buyers": len(r.get("early_buyers", [])), "seconds": round(time.time() - t, 1),
                        "schema_valid": True, "confidence": r.get("confidence"),
                        "note": "reduced params (15 buyers, 1 hop, 8 traced wallets); cached data reused when present"}
        checks.append(_check("e2e_score", e2e))

    overall = all(c["pass"] for c in checks if c["required"])
    return {"overall": "pass" if overall else "fail", "provider": "helius" if s.helius_api_key else "public-rpc",
            "checked_at": int(time.time()), "checks": checks}


def main(argv=None):
    import argparse
    ap = argparse.ArgumentParser(prog="python -m risk health")
    _args(ap)
    a = ap.parse_args(argv)
    _main(a)


def _args(p):
    p.add_argument("--mint", default=None, help="default: a fresh busy launch from paper.db, else DEFAULT_MINT")
    p.add_argument("--quick", action="store_true", help="skip end-to-end score (v0 semantics)")
    p.add_argument("--no-tests", action="store_true", help="skip the offline pytest run")


def _main(a):
    res = run(a.mint, a.quick, not a.no_tests)
    print(json.dumps(res, indent=2, default=str))
    sys.exit(0 if res["overall"] == "pass" else 1)


def add_parser(sub):
    p = sub.add_parser("health", aliases=["healthcheck"], help="pass/fail JSON health report")
    _args(p)
    p.set_defaults(fn=_main)
