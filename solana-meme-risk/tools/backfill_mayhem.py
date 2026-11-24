"""One-off / repeatable: record the Mayhem flag (smr/mayhem.py) on every scored launch in data/paper.db, copy it onto
positions, and drop Mayhem coins from the strategy 'waiting for $30k' list (strategy_status -> skip_mayhem) and the
momentum watch list (momentum_status -> skip_mayhem). Open positions are NOT touched (they run to their normal exit).
Holds the paper cycle lock, so it never overlaps a `risk paper cycle`. Usage: .venv/bin/python tools/backfill_mayhem.py [--db PATH]"""
import argparse, fcntl, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from smr.context import Context
from smr.paper.engine import Cycle, default_ledger_path, _NoPumpFun
from smr.paper.ledger import Ledger

ap = argparse.ArgumentParser()
ap.add_argument("--db", default=None)
a = ap.parse_args()
ctx = Context(); ctx.pumpfun = _NoPumpFun()
path = a.db or default_ledger_path(ctx)
lockf = open(path + "-cycle.lock", "w")
try:
    fcntl.flock(lockf, fcntl.LOCK_EX | fcntl.LOCK_NB)
except OSError:
    print(json.dumps({"skipped": "a paper cycle is running"})); sys.exit(2)
led = Ledger(path)                      # adds the mayhem columns if missing
c = Cycle(ctx, led, budget_s=10**6)
n = c.backfill_mayhem(limit=100000)
wait = led.q("SELECT * FROM launches WHERE strategy_status='filtered_mcap' AND void_reason IS NULL")
watch = led.q("SELECT * FROM launches WHERE momentum_status='watching' AND void_reason IS NULL")
kept_w = c._mayhem_prefilter(wait, "strategy_status", "waiting_dropped")
kept_m = c._mayhem_prefilter(watch, "momentum_status", "watching_dropped")
c.backfill_mayhem(limit=0)              # copy flags onto positions
summ = led.one("SELECT COUNT(*) AS n, SUM(mayhem=1) AS mayhem, SUM(mayhem=0) AS not_mayhem, SUM(mayhem IS NULL) AS unknown FROM launches WHERE status='scored' AND void_reason IS NULL")
print(json.dumps({"resolved_now": n, "stats": c.stats["mayhem"], "launches": summ,
                  "waiting_before": len(wait), "waiting_after": len(kept_w), "waiting_unknown": sum(l.get("mayhem") is None for l in kept_w),
                  "watching_before": len(watch), "watching_after": len(kept_m),
                  "positions": led.q("SELECT book, mayhem, status, COUNT(*) AS n FROM positions WHERE void_reason IS NULL GROUP BY 1,2,3")}, indent=1, default=str))
led.close()
