"""Measure vet() latency on recent real pump.fun mints (read-only: DexScreener/GeckoTerminal discovery + public RPC).
  python tools/vet_latency_probe.py --n 8 --budget-s 150 -o data/vet/latency_<ts>.json
Runs each mint cold (first vet of that mint; shared wallet/tx caches warm, as in production), then a send-time recheck."""
from __future__ import annotations
import argparse, json, os, sys, time, statistics
from dataclasses import replace
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import requests
from smr.vet import vet, VetConfig

UA = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}


def discover(n, exclude=()):
    cands = []
    for path in ("/token-profiles/latest/v1", "/token-boosts/latest/v1", "/token-boosts/top/v1"):
        try:
            for x in requests.get("https://api.dexscreener.com" + path, headers=UA, timeout=20).json():
                if x.get("chainId") == "solana" and str(x.get("tokenAddress", "")).endswith("pump"):
                    cands.append(x["tokenAddress"])
        except Exception:
            pass
    young = []       # the executor's real universe: pump coins younger than ~30 h (free RPC history window)
    for path in ("/networks/solana/trending_pools?duration=1h&page=1", "/networks/solana/trending_pools?duration=6h&page=1",
                 "/networks/solana/new_pools?page=1", "/networks/solana/new_pools?page=2", "/networks/solana/dexes/pumpswap/pools?page=1"):
        try:
            for p in requests.get("https://api.geckoterminal.com/api/v2" + path, headers=UA, timeout=20).json()["data"]:
                if p["relationships"]["dex"]["data"]["id"] not in ("pump-fun", "pumpswap"):
                    continue
                m = p["relationships"]["base_token"]["data"]["id"].split("_", 1)[1]
                created = p["attributes"].get("pool_created_at")
                age_h = (time.time() - time.mktime(time.strptime(created[:19], "%Y-%m-%dT%H:%M:%S")) + time.timezone) / 3600 if created else None
                (young if age_h is not None and age_h < 30 else cands).append(m)
        except Exception:
            pass
        time.sleep(2.5)
    cands = young + cands
    cands = [c for c in dict.fromkeys(cands) if c not in set(exclude)]
    mc = {}
    for i in range(0, len(cands), 30):
        try:
            for p in requests.get("https://api.dexscreener.com/tokens/v1/solana/" + ",".join(cands[i:i + 30]), headers=UA, timeout=20).json():
                a = p["baseToken"]["address"]
                mc[a] = max(mc.get(a, 0), p.get("marketCap") or 0), p.get("dexId")
        except Exception:
            pass
    big = [m for m in cands if (mc.get(m) or (0,))[0] >= 30_000]
    small = [m for m in cands if 0 < (mc.get(m) or (0,))[0] < 30_000]
    pick = big[: max(1, n - 2)] + small[:2]
    return pick[:n], {m: mc.get(m) for m in pick}


def pct(xs, q):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    k = (len(xs) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(xs) - 1)
    return round(xs[lo] + (xs[hi] - xs[lo]) * (k - lo))


def check_latency(t):
    """Critical-path latency per check; None when the check's facts were never fetched (short-circuit)."""
    g = lambda k: t.get(k)
    def tot(*ks):
        v = [g(k) for k in ks]
        return None if any(x is None for x in v) else sum(v)
    def mx(*ks):
        v = [g(k) for k in ks if g(k) is not None]
        return max(v) if v else None
    return {"authority+mayhem": mx("curve", "mint"), "market": mx("curve", "sol_usd", "dex"),
            "holders_gpa": g("holders"), "bundle_sniper(early)": g("early"), "funding_cluster(early+traces)": tot("early", "traces"),
            "creator_history(early+serial)": tot("early", "serial"), "refresh_total": g("refresh_total")}


def full_path(r):
    t = r["cold"]["fact_latency_ms"]
    return all((t.get(k) or 0) > 0 for k in ("early", "traces", "serial"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=8)
    ap.add_argument("--budget-s", type=float, default=150)
    ap.add_argument("--exclude-from", nargs="*", default=[], help="earlier probe JSONs: skip their mints (keeps runs cold)")
    ap.add_argument("-o", "--out", default=f"data/vet/latency_{time.strftime('%Y%m%d_%H%M%S')}.json")
    a = ap.parse_args()
    excl = [r["mint"] for f in a.exclude_from if os.path.exists(f) for r in json.load(open(f))["rows"]]
    mints, mc = discover(a.n, excl)
    cfg = replace(VetConfig(), budget_s=a.budget_s)
    rows = []
    for m in mints:
        r1 = vet(m, cfg=cfg).to_dict()
        r2 = vet(m, cfg=cfg).to_dict()   # send-time recheck: slow facts cached, mutable facts re-read
        row = {"mint": m, "dex_mcap_at_discovery": mc.get(m), "cold": {"verdict": r1["verdict"], "latency_ms": r1["latency_ms"],
               "fact_latency_ms": r1["cache"]["fact_latency_ms"], "check_latency_ms": check_latency(r1["cache"]["fact_latency_ms"]),
               "checks": {n: c["status"] for n, c in r1["checks"].items()},
               "reasons": [(x["check"], x["code"], x["observed"]) for x in r1["reasons"]],
               "metrics": {n: c["metrics"] for n, c in r1["checks"].items()}},
               "recheck": {"verdict": r2["verdict"], "latency_ms": r2["latency_ms"], "cache": r2["cache"].get("slow_facts"),
                           "fact_latency_ms": r2["cache"]["fact_latency_ms"]}}
        rows.append(row)
        print(json.dumps({"mint": m[:10], "cold_ms": r1["latency_ms"], "recheck_ms": r2["latency_ms"], "verdict": r1["verdict"],
                          "facts": r1["cache"]["fact_latency_ms"], "fails": [x[1] for x in row["cold"]["reasons"]]}), flush=True)
    keys = list(rows[0]["cold"]["check_latency_ms"]) if rows else []
    summary = {"n": len(rows), "budget_s": a.budget_s,
               "total_cold_ms": {"p50": pct([r["cold"]["latency_ms"] for r in rows], .5), "p95": pct([r["cold"]["latency_ms"] for r in rows], .95),
                                 "max": max((r["cold"]["latency_ms"] for r in rows), default=None)},
               "full_path_n": sum(1 for r in rows if full_path(r)),
               "total_cold_full_path_ms": {"p50": pct([r["cold"]["latency_ms"] for r in rows if full_path(r)], .5),
                                           "p95": pct([r["cold"]["latency_ms"] for r in rows if full_path(r)], .95),
                                           "max": max((r["cold"]["latency_ms"] for r in rows if full_path(r)), default=None)},
               "total_recheck_ms": {"p50": pct([r["recheck"]["latency_ms"] for r in rows], .5), "p95": pct([r["recheck"]["latency_ms"] for r in rows], .95)},
               "per_check_cold_ms": {k: {"p50": pct([r["cold"]["check_latency_ms"][k] for r in rows], .5),
                                         "p95": pct([r["cold"]["check_latency_ms"][k] for r in rows], .95)} for k in keys},
               "per_fact_cold_ms": {}, "verdicts": {}}
    facts = sorted({k for r in rows for k in r["cold"]["fact_latency_ms"]})
    for k in facts:
        xs = [r["cold"]["fact_latency_ms"].get(k) for r in rows]
        summary["per_fact_cold_ms"][k] = {"p50": pct(xs, .5), "p95": pct(xs, .95), "timeouts": sum(1 for x in xs if x is None)}
    for r in rows:
        summary["verdicts"][r["cold"]["verdict"]] = summary["verdicts"].get(r["cold"]["verdict"], 0) + 1
    out = {"run_at": time.time(), "summary": summary, "rows": rows}
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    json.dump(out, open(a.out, "w"), indent=1, default=str)
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
