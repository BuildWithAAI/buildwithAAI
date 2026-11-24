"""Read-only: Mayhem-mode share and outcomes across data/paper.db and the backtest DB (smr/mayhem.py detection).
Usage: .venv/bin/python tools/measure_mayhem.py [--curve-all] [--out FILE]
Create txs come from the RPC cache (fetched by the sampler / paper cycle); the curve account flag is read for paper
launches and labeled backtest launches (one getAccountInfo each), or for every launch with --curve-all."""
import argparse, json, os, sqlite3, sys, time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from smr.context import default_context
from smr import mayhem as MY

ap = argparse.ArgumentParser()
ap.add_argument("--paper", default="data/paper.db")
ap.add_argument("--backtest", default="data/backtest/work/backtest.db")
ap.add_argument("--curve-all", action="store_true")
ap.add_argument("--parallel", type=int, default=4)
ap.add_argument("--out", default=None)
a = ap.parse_args()
ctx = default_context()
ro = lambda p: sqlite3.connect(f"file:{p}?mode=ro", uri=True)


def run(rows, want_curve):
    """rows: dicts with mint, create_sig[, curve, supply]. -> {mint: classify dict}"""
    def one(r):
        try:
            tx = ctx.rpc.get_transaction(r["create_sig"])
        except Exception:
            tx = None
        if want_curve(r):
            return r["mint"], MY.detect(ctx, r["mint"], create_sig=r["create_sig"], curve=r.get("curve"), supply=r.get("supply"), tx=tx or None) \
                if tx else MY.detect(ctx, r["mint"], curve=r.get("curve"), supply=r.get("supply"))
        return r["mint"], {**MY.classify(None, MY.from_create_tx(tx, r["mint"]) if tx else None, r.get("supply")), "curve": r.get("curve")}
    with ThreadPoolExecutor(a.parallel) as ex:
        return dict(ex.map(one, rows))


def share(res):
    c = Counter("mayhem" if v["mayhem"] is True else "not" if v["mayhem"] is False else "unknown" for v in res.values())
    known = c["mayhem"] + c["not"]
    return {"n": len(res), "mayhem": c["mayhem"], "not_mayhem": c["not"], "unknown": c["unknown"],
            "mayhem_pct_of_known": round(100 * c["mayhem"] / known, 1) if known else None,
            "sources": dict(Counter(v["source"] for v in res.values()))}


def rate(rows):
    return {"n": len(rows), "bad": sum(rows), "bad_pct": round(100 * sum(rows) / len(rows), 1) if rows else None}


t0 = time.time()
out = {"generated_at": time.strftime("%Y-%m-%d %H:%M %Z")}
# ---- paper.db ----
p = ro(a.paper); p.row_factory = sqlite3.Row
L = [dict(r) for r in p.execute("SELECT * FROM launches WHERE void_reason IS NULL OR void_reason IS NOT NULL")]
pres = run([l for l in L if l["create_sig"]], lambda r: True)
out["paper_launches"] = share(pres)
# agreement between sources where both read
agree = Counter((v["evidence"]["curve_flag"], v["evidence"]["create_tx"]) for v in pres.values())
out["paper_source_agreement_curve_vs_tx"] = {f"{k[0]}/{k[1]}": n for k, n in agree.items()}
sup = Counter(("supply>1B" if (l["supply"] or 0) > MY.SUPPLY_MAYHEM_MIN else "supply~1B" if l["supply"] else "no supply",
               {True: "mayhem", False: "not", None: "unknown"}[pres.get(l["mint"], {}).get("mayhem")]) for l in L)
out["paper_supply_vs_flag"] = {f"{k[0]}|{k[1]}": n for k, n in sup.items()}
M = lambda m: {True: "mayhem", False: "not_mayhem", None: "unknown"}[pres.get(m, {}).get("mayhem")]
# outcomes: launch-level 24 h track (dumped >= 50% within 24 h of first price, or no price 24 h)
oc = {}
for l in L:
    if l["void_reason"] is None and l["entry_status"] == "priced" and (l["track_done"] or l["dumped50"]):
        oc.setdefault(M(l["mint"]), []).append(int(bool(l["dumped50"])))
out["paper_resolved_dump50"] = {k: rate(v) for k, v in oc.items()}
for book in ("shadow", "all", "strategy", "momentum"):
    ps = [dict(r) for r in p.execute("SELECT * FROM positions WHERE book=? AND void_reason IS NULL", (book,))]
    g = {}
    for x in ps:
        d = g.setdefault(M(x["mint"]), {"positions": 0, "open": 0, "closed": 0, "closed_pnl_usd": 0.0, "closed_losers": 0, "exit_reasons": Counter()})
        d["positions"] += 1
        if x["status"] == "closed":
            d["closed"] += 1; d["closed_pnl_usd"] = round(d["closed_pnl_usd"] + x["pnl_usd"], 2); d["closed_losers"] += int(x["pnl_usd"] <= 0)
            d["exit_reasons"][x["exit_reason"]] += 1
        else:
            d["open"] += 1
    for k, d in g.items():
        d["exit_reasons"] = dict(d["exit_reasons"])
        rr = [x["pnl_pct"] for x in ps if x["status"] == "closed" and M(x["mint"]) == k]
        d["mean_closed_return_pct"] = round(100 * sum(rr) / len(rr), 1) if rr else None
    out[f"paper_book_{book}"] = g
# would-have-blocked: past alerted-book entries and current waiting / watching
ent = [dict(r) for r in p.execute("SELECT p.id, p.book, p.mint, p.status, p.void_reason, p.entry_at, l.symbol FROM positions p JOIN launches l USING(mint) "
                                  "WHERE p.book IN ('strategy','momentum') ORDER BY p.entry_at")]
out["past_alerted_entries"] = [{**e, "mayhem": M(e["mint"]), "source": pres.get(e["mint"], {}).get("source")} for e in ent]
now = time.time()
wait = [l for l in L if l["void_reason"] is None and l["strategy_status"] == "filtered_mcap" and now - l["created_at"] <= 86400]
watch = [l for l in L if l["void_reason"] is None and l["momentum_status"] == "watching"]
out["waiting_for_30k"] = {"n": len(wait), **Counter(M(l["mint"]) for l in wait)}
out["momentum_watching"] = {"n": len(watch), **Counter(M(l["mint"]) for l in watch)}
out["waiting_all_rows_filtered_mcap"] = {"n": sum(l["strategy_status"] == "filtered_mcap" for l in L if l["void_reason"] is None)}
# non-SKIP priced launches = the books' candidate pool before the floor
pool = [l for l in L if l["void_reason"] is None and l["entry_status"] == "priced" and l["decision"] in ("NORMAL", "REDUCED")]
out["non_skip_priced_pool"] = {"n": len(pool), **Counter(M(l["mint"]) for l in pool)}
over = [l for l in pool if (l["first_priced_mcap"] or 0) >= 30000 or (l["max_fdv_seen"] or 0) >= 30000]
out["non_skip_ever_over_30k"] = {"n": len(over), **Counter(M(l["mint"]) for l in over)}
# ---- backtest.db ----
b = ro(a.backtest); b.row_factory = sqlite3.Row
C = [dict(r) for r in b.execute("SELECT create_sig, mint, curve, create_time, eligible FROM candidates WHERE mint IS NOT NULL")]
labels = {r["mint"]: json.loads(r["doc"]) for r in b.execute("SELECT mint, doc FROM labels")}
bres = run(C, lambda r: a.curve_all or r["mint"] in labels)
out["backtest_candidates"] = share(bres)
out["backtest_eligible"] = share({c["mint"]: bres[c["mint"]] for c in C if c["eligible"]})
BM = lambda m: {True: "mayhem", False: "not_mayhem", None: "unknown"}[bres.get(m, {}).get("mayhem")]
lab = {}
for m, d in labels.items():
    if d.get("usable") and d.get("bad_24h") is not None:
        g = lab.setdefault(BM(m), {"bad_24h": [], "loss50_24h": [], "dead_24h": [], "graduated_24h": []})
        for k in g:
            g[k].append(int(bool(d.get(k))))
out["backtest_labels"] = {k: {kk: rate(vv) for kk, vv in v.items()} for k, v in lab.items()}
# over time (does the share change?) by CST day
days = {}
for c in C:
    dday = time.strftime("%Y-%m-%d", time.localtime(c["create_time"])) if c["create_time"] else "?"
    days.setdefault(dday, Counter())[BM(c["mint"])] += 1
out["backtest_by_day"] = {k: dict(v) for k, v in sorted(days.items())}
out["elapsed_s"] = round(time.time() - t0, 1)
s = json.dumps(out, indent=1, default=str)
if a.out:
    open(a.out, "w").write(s)
print(s)
