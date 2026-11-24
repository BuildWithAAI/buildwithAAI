"""Record a deterministic replay fixture for one mint (integration test + rule unit-test inputs).

  .venv/bin/python tools/record_fixture.py <MINT> [--as-of UNIX|launch] [--buyers 15] [--trace-limit 8] [--lookback-h 1]

Writes tests/fixtures/<mint[:8]>.replay.json.gz with: the settings overrides used, every cache entry touched
(RPC + HTTP responses), the create-stream rows needed for as-of anchoring, the extracted signals and the
expected report fields."""
from __future__ import annotations
import argparse, gzip, json, os, sys, dataclasses
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from smr import config as C
from smr.context import Context
from smr.signal_extractor import extract_signals
from smr.risk_score import score_signals
from smr import report

ap = argparse.ArgumentParser()
ap.add_argument("mint"); ap.add_argument("--as-of", default="launch")
ap.add_argument("--buyers", type=int, default=15); ap.add_argument("--trace-limit", type=int, default=8)
ap.add_argument("--lookback-h", type=float, default=1.0)
ap.add_argument("--out", default=None)
a = ap.parse_args()

overrides = {"early_buyers_n": a.buyers, "serial_lookback_hours": a.lookback_h, "serial_prior_coins_checked": 3}
import tempfile
_tmp = tempfile.mkdtemp(prefix="smr-rec-")
# fresh funding graph so every trace is actually fetched (and therefore recorded)
s = dataclasses.replace(C.load_settings(), graph_db=os.path.join(_tmp, "funding_graph.db"), **overrides)
ctx = Context(s)
coin = ctx.pumpfun.coin(a.mint) or {}
as_of = int(coin["created_timestamp"] / 1000) + s.score_delay_s if a.as_of == "launch" else int(a.as_of)
ctx.cache.recorder = {}
sig = extract_signals(ctx, a.mint, as_of=as_of, n_buyers=a.buyers, trace_limit=a.trace_limit, coin=coin)
sig["token_age_s"] = (sig["as_of"] - sig["create_time"]) if sig.get("create_time") else 0
sc = score_signals(sig, s, False)
doc = report.build(sig, sc, s, sources=ctx.source_snapshot(), generated_at=ctx.clock(), full=False)
lo = int((sig.get("create_time") or as_of) - a.lookback_h * 3600 - 900)
rows = ctx.anchors.db.execute("SELECT signature, slot, block_time, err FROM stream WHERE block_time BETWEEN ? AND ?", (lo, as_of + 900)).fetchall()
fx = {"mint": a.mint, "as_of": as_of, "settings_overrides": overrides, "trace_limit": a.trace_limit, "coin": coin,
      "stream_rows": rows, "cache": ctx.cache.recorder,
      "signals": json.loads(json.dumps(sig, default=str)),
      "expected": {"score": doc["score"], "recommendation": doc["recommendation"], "hard_flags": doc["hard_flags"],
                   "rule_points": {r["rule"]: r["points"] for r in doc["rules"]}}}
out = a.out or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tests", "fixtures", f"{a.mint[:8]}.replay.json.gz")
with gzip.open(out, "wt") as f:
    json.dump(fx, f, separators=(",", ":"))
print(out, os.path.getsize(out), "bytes;", len(ctx.cache.recorder), "cache entries;", len(rows), "stream rows;", fx["expected"])
