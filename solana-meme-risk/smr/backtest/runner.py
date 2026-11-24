"""Score every eligible sampled launch AS OF create+300s (point-in-time; see AnchorIndex) and label it."""
from __future__ import annotations
import json, time, traceback
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from .. import logging_setup as L
from ..pipeline import score_mint
from . import labeler

log = L.get("bt.run")


def _one(ctx, store, cand, delay):
    mint = cand["mint"]; as_of = cand["create_time"] + delay
    t = time.time()
    try:
        coin = ctx.pumpfun.coin(mint) or {}
    except Exception:
        coin = {}
    try:
        if not store.q("SELECT 1 FROM labels WHERE mint=?", (mint,)):
            store.put_label(mint, as_of, labeler.label(ctx, cand, as_of, coin))
        doc = score_mint(mint, ctx=ctx, as_of=as_of, full=False, coin=coin or None)
        store.put_scored(mint, as_of, doc, None, time.time(), time.time() - t)
        tr = ((doc.get("data_coverage") or {}).get("tracer")) or {}
        return mint, doc["recommendation"], doc["score"], round(time.time() - t, 1), tr
    except Exception as e:
        store.put_scored(mint, as_of, None, f"{type(e).__name__}: {e}\n{traceback.format_exc()[-1500:]}", time.time(), time.time() - t)
        return mint, "ERROR", str(e)[:120], round(time.time() - t, 1)


def add_tracer_stats(tot, stats):
    """Sum a launch's funding-tracer counters (probes, probe_cache_hits, hubs, hub_page_skips, ...) into `tot`.
    Non-numeric or missing values are ignored, so an errored launch or an older doc adds nothing."""
    for key, v in (stats or {}).items():
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            tot[key] = tot.get(key, 0) + v
    return tot


def run(ctx, store, limit=None, parallel=3, max_age_h=None, progress=print, budget_s=None, clock=time.time, newest_first=False,
        hard_grace_s=120.0):
    """max_age_h: only score launches younger than this. Free RPC history is the binding constraint: publicnode
    serves `before` anchors and version-1 transactions only for roughly the last ~40 h (measured 2026-11-01);
    older history falls back to api.mainnet-beta (~3.5 rps), which makes a large backtest impractical.
    budget_s: stop submitting new launches once this many seconds have passed (in-flight launches finish), so a
    session can't stall on slow RPC. Progress is reported as each launch completes (as_completed), not in order.
    newest_first: score the youngest launches first. Their own early txs are still inside publicnode's ~36 h
    history window (fast) instead of falling through to slow mainnet-beta; the default stays oldest-first.
    hard_grace_s: with a budget, in-flight launches still running hard_grace_s after the budget are abandoned
    (not saved; picked up by a later run) so one slow 36 h+ launch can't hold the run for 10+ min. Abandoned worker
    threads may still be alive: the summary has "abandoned" > 0 and the CLI then exits the process.
    Returns a summary dict."""
    cols = ["create_sig", "mint", "create_time", "slot", "creator", "curve", "txs_first_5m"]
    min_ct = time.time() - max_age_h * 3600 if max_age_h else 0
    rows = store.q(f"SELECT {','.join(cols)} FROM candidates WHERE eligible=1 AND create_time >= ? AND mint NOT IN (SELECT mint FROM scored WHERE doc IS NOT NULL) ORDER BY create_time" + (" DESC" if newest_first else ""), (min_ct,))
    cands = [dict(zip(cols, r)) for r in rows][: limit or None]
    progress(f"scoring {len(cands)} launches, {parallel} in parallel" + (f", budget {budget_s:.0f}s" if budget_s else ""))
    tracer_tot = {}
    t0 = clock(); k = 0; submitted = 0; pending = set(); it = iter(cands); stopped = False
    ex = ThreadPoolExecutor(parallel); abandoned = 0
    def submit_more():
        nonlocal submitted, stopped
        while len(pending) < parallel and not stopped:
            if budget_s is not None and clock() - t0 >= budget_s:
                stopped = True; break
            c = next(it, None)
            if c is None:
                break
            pending.add(ex.submit(_one, ctx, store, c, ctx.settings.score_delay_s)); submitted += 1
    try:
        submit_more()
        while pending:
            timeout = None
            if budget_s is not None and hard_grace_s is not None:
                timeout = max(0.0, t0 + budget_s + hard_grace_s - clock())
            done, _ = wait(pending, timeout=timeout, return_when=FIRST_COMPLETED)
            if not done:
                abandoned = len(pending); stopped = True
                progress(f"hard deadline: abandoning {abandoned} in-flight launch(es) (not saved)")
                break
            for f in done:
                pending.discard(f)
                r = f.result(); k += 1
                add_tracer_stats(tracer_tot, r[4] if len(r) > 4 else None)
                progress(f"[{k}/{len(cands)}] {r[0][:10]} {r[1]} {r[2]} {r[3]}s")
            submit_more()
    finally:
        ex.shutdown(wait=not abandoned, cancel_futures=True)
    el = clock() - t0
    out = {"eligible": len(cands), "scored": k, "budget_hit": stopped, "elapsed_s": round(el, 1),
           "per_launch_s": round(el / k, 1) if k else None, "tracer": tracer_tot, "abandoned": abandoned}
    progress(f"done: {out}")
    snap = getattr(getattr(ctx, "rpc", None), "snapshot", None)
    if callable(snap):
        try:
            progress(f"rpc: {snap()}")
        except Exception:
            pass
    return out


def export(store, path):
    """Dataset row per labeled + scored launch (compact: rule points/values, coverage, label fields)."""
    lab = {m: json.loads(d) for m, d in store.q("SELECT mint, doc FROM labels")}
    cand = {r[0]: {"create_time": r[1], "txs_first_5m": r[2], "creator": r[3]} for r in store.q("SELECT mint, create_time, txs_first_5m, creator FROM candidates WHERE eligible=1")}
    n = 0
    with open(path, "w") as f:
        for mint, as_of, doc, err, el in store.q("SELECT mint, as_of, doc, error, elapsed_s FROM scored ORDER BY as_of"):
            if not doc or mint not in lab:
                continue
            d = json.loads(doc); lb = lab[mint]
            row = {"mint": mint, "symbol": d["asset"].get("symbol"), **cand.get(mint, {}), "as_of": as_of,
                   "score": d["score"], "raw_points": d.get("raw_points"), "recommendation": d["recommendation"], "confidence": d["confidence"]["label"],
                   "confidence_score": d["confidence"]["score"], "hard_flags": d["hard_flags"],
                   "rules": {r["rule"]: {"points": r["points"], "max": r["max_points"], "triggered": r["triggered"], "data": r["data_available"],
                                         "evidence": r.get("evidence")} for r in d["rules"]},
                   "coverage": {k: v for k, v in d["data_coverage"].items() if k not in ("sources", "warnings")},
                   "n_warnings": len(d["data_coverage"].get("warnings", [])), "elapsed_s": round(el or 0, 1),
                   "model": d["model"]["version"],
                   "label": {k: lb.get(k) for k in ("usable", "bad_24h", "loss50_24h", "dead_24h", "crash_24h", "graduated_24h", "return_24h",
                                                    "bad_1h", "bad_6h", "label_version")},
                   "entry_x_launch": (lb.get("entry") or {}).get("ratio"),
                   "x_launch_24h": ((lb.get("horizons") or {}).get("24h") or {}).get("ratio")}
            f.write(json.dumps(row) + "\n"); n += 1
    return n
