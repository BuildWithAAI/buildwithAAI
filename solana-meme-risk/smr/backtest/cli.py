"""python -m risk backtest {sample,run,export,calibrate,report,all}"""
from __future__ import annotations
import os


def _paths(ctx):
    work = os.path.join(ctx.settings.data_dir, "backtest", "work"); os.makedirs(work, exist_ok=True)
    repo = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    out = os.path.join(repo, "backtest"); os.makedirs(out, exist_ok=True)
    return os.path.join(work, "backtest.db"), out


def _main(a):
    from ..context import default_context
    from .store import Store
    from . import sampler, runner
    ctx = default_context()
    dbp, out = _paths(ctx)
    st = Store(dbp)
    pr = lambda m: print(f"[backtest] {m}", flush=True)
    if a.step in ("sample", "all"):
        pr(f"candidates/eligible: {sampler.sample(ctx, st, n=a.n, min_age_h=a.min_age_h, max_age_h=a.max_age_h, min_txs=a.min_txs, progress=pr)}")
    if a.step in ("run", "all"):
        res = runner.run(ctx, st, limit=a.limit, parallel=a.parallel, max_age_h=a.max_age_h if a.step == 'run' else None, progress=pr,
                   budget_s=a.budget_min * 60 if a.budget_min else None, newest_first=a.newest_first)
        if res.get("abandoned"):
            # abandoned scorer threads are non-daemon and would keep the process alive; finished launches are committed
            import sys
            sys.stdout.flush(); os._exit(0)
    if a.step in ("export", "all", "calibrate", "report"):
        pr(f"exported {runner.export(st, os.path.join(out, 'dataset.jsonl'))} rows -> backtest/dataset.jsonl")
    if a.step in ("calibrate", "all", "report"):
        from . import calibrate
        calibrate.main(os.path.join(out, "dataset.jsonl"), out, ctx.settings, fit=a.step != "report", progress=pr)


def add_parser(sub):
    p = sub.add_parser("backtest", help="historical point-in-time backtest")
    p.add_argument("step", choices=["sample", "run", "export", "calibrate", "report", "all"])
    p.add_argument("--n", type=int, default=600, help="random creates to check for eligibility")
    p.add_argument("--min-age-h", type=float, default=26)
    p.add_argument("--max-age-h", type=float, default=72)
    p.add_argument("--min-txs", type=int, default=15)
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--parallel", type=int, default=3)
    p.add_argument("--budget-min", type=float, default=None, help="run: stop starting new launches after N minutes")
    p.add_argument("--newest-first", action="store_true", help="run: score the youngest eligible launches first")
    p.set_defaults(fn=_main)
