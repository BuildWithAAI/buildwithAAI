"""CLI for the isolated $100 paper experiment (book=experiment100). Simulation only.

Uses data/experiment100/paper.db + scanner.json + paper_edge.json. Never opens data/paper.db.
Does not start the legacy paper cycle or $1000 books. Real trading stays disabled."""
from __future__ import annotations
import json, os, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EXP_DIR = os.path.join(ROOT, "data", "experiment100")
DEFAULT_DB = os.path.join(EXP_DIR, "paper.db")
COST_CAVEAT = (
    "Percent cost model (smr/paper/costs.py): 1%/side fee + 0.5%/side base slip + impact v/(R+v). "
    "PLUS experiment100 fixed Solana fees from data/experiment100/fixed_fees.json (versioned, forward-only): "
    "sourced base fee 5000 lamports/sig + rent-exempt ATA; priority fee and Jito tip are LABELED modeled conservative "
    "screens (NOT observed executor settings; no venue configured). Dust policy typically forfeits rent. "
    "Do not treat paper fills as proven live-feasible."
)

def _maintenance(db):
    import os, json, time
    path = os.path.join(os.path.dirname(os.path.abspath(db)), "MAINTENANCE.json")
    try:
        with open(path) as f:
            m = json.load(f)
    except (OSError, ValueError):
        return {"active": False}
    if not m.get("active"):
        return {"active": False, **{k: m.get(k) for k in ("reason", "cleared_at_ct") if k in m}}
    until = m.get("until")
    if until is not None and time.time() > float(until):
        return {"active": False, "expired": True, "until_ct": m.get("until_ct")}
    return m


def _db(a):
    return os.path.abspath(a.db or DEFAULT_DB)


def _assert_isolated(db):
    db = os.path.abspath(db)
    legacy = os.path.abspath(os.path.join(ROOT, "data", "paper.db"))
    if db == legacy:
        raise SystemExit("experiment100 refuses the legacy data/paper.db — pass data/experiment100/paper.db")
    if os.path.dirname(db) != os.path.abspath(EXP_DIR):
        # allow tests with tmp paths; production default stays under experiment100/
        pass


def _scanner(a):
    from . import scanner as S
    db = _db(a)
    _assert_isolated(db)
    if a.action == "run":
        raise SystemExit(S.run_forever(db, a.interval))
    if a.action == "once":
        out = S.once(db)
        out["cost_model_caveat"] = COST_CAVEAT
        print(json.dumps(out, indent=2, default=str)); return
    r = {"status": S.status, "stop": S.stop}.get(a.action)
    out = r(db) if r else S.start(db, a.interval)
    out["experiment"] = "experiment100"
    out["db"] = db
    out["cost_model_caveat"] = COST_CAVEAT
    if a.quiet and a.action == "start":
        out = {k: out.get(k) for k in ("action", "running", "healthy", "pid", "heartbeat_age_s", "cycles", "errors", "last_error", "experiment", "db")}
    print(json.dumps(out, indent=2, default=str))
    if a.action == "status" and a.check and not out.get("healthy"):
        raise SystemExit(1)


def _watcher(a):
    from . import watcher as W
    from .engine import default_ledger_path
    db = _db(a)
    _assert_isolated(db)
    if a.action == "run":
        raise SystemExit(W.run_forever(db, a.interval, a.gt_per_min))
    if a.action == "once":
        from .ledger import Ledger
        from . import sigbooks as SB
        led = Ledger(db)
        dex, gt, src = W.live_sources()
        w = W.Watcher(led, dex, gt, interval_s=a.interval, gt_per_min=a.gt_per_min, heartbeat_path=None, pid=-os.getpid(), sources=src)
        r = w.tick()
        with led.tx():
            SB.release_lease(led, w.pid)
        print(json.dumps(r, indent=2, default=str)); return
    r = {"status": W.status, "stop": W.stop}.get(a.action)
    out = r(db) if r else W.start(db, a.interval, a.gt_per_min)
    out["experiment"] = "experiment100"
    out["db"] = db
    if a.quiet and a.action == "start":
        out = {k: out.get(k) for k in ("action", "running", "healthy", "pid", "heartbeat_age_s", "ticks", "errors", "last_error", "experiment", "db")}
    print(json.dumps(out, indent=2, default=str))
    if a.action == "status" and a.check and not out.get("healthy"):
        raise SystemExit(1)


def _account(led):
    """Explicit cash vs realized vs marked equity for experiment100. Size-up uses cash only."""
    from .engine import EXPERIMENT100_BOOK, book_state, liquidation_value
    from . import sigexit as SX
    from .report import book_report
    st = book_state(led, EXPERIMENT100_BOOK)
    b = book_report(led, EXPERIMENT100_BOOK)
    opn = led.q("SELECT * FROM positions WHERE book=? AND status='open' AND void_reason IS NULL", (EXPERIMENT100_BOOK,))
    closed = led.q("SELECT * FROM positions WHERE book=? AND status='closed' AND void_reason IS NULL", (EXPERIMENT100_BOOK,))
    # costs paid (modeled): entry_cost * size + exit_cost * exit value approximations from stored columns
    entry_costs = sum((p.get("entry_cost") or 0) * (p.get("size_usd") or 0) for p in opn + closed)
    exit_costs = 0.0
    for p in closed:
        # proceeds already net of exit_cost; recover modeled exit drag from tokens*fill*exit_cost when present
        if p.get("exit_cost") is not None and p.get("exit_fill_price") is not None:
            # tradeable tokens approx size path: use (proceeds/(1-exit_cost) - proceeds) when exit_cost<1
            xc = p["exit_cost"]
            proc = (p.get("proceeds_usd") or 0) - (p.get("partial_proceeds_usd") or 0)
            if 0 <= xc < 1 and proc:
                exit_costs += proc * xc / (1 - xc)
        exit_costs += sum(c.get("exit_cost_usd") or 0 for c in [])  # placeholder no-op
    # partial clip costs already embedded in partial_proceeds; report fee drag from clip_log when present
    clip_cost_drag = 0.0
    for p in opn + closed:
        try:
            log = json.loads(p.get("clip_log") or "[]")
        except ValueError:
            log = []
        for c in log:
            if c.get("exit_cost_pct") is not None and c.get("proceeds_usd") is not None:
                # proceeds are after cost; reconstruct drag
                pct = c["exit_cost_pct"] / 100.0
                if 0 <= pct < 1:
                    clip_cost_drag += c["proceeds_usd"] * pct / (1 - pct)
    dust_open = sum(SX.dust_value(p.get("dust_tokens") or 0, p.get("last_price") or p.get("dust_last_price"),
                                  p.get("last_liq") or p.get("dust_liq"), p.get("entry_cost") or 0) for p in opn)
    dust_closed_mark = sum(SX.dust_value(p.get("dust_tokens") or 0, p.get("dust_last_price"), p.get("dust_liq"),
                                         p.get("entry_cost") or 0) for p in closed if p.get("dust_tokens"))
    # realized = closed pnl (dust counted 0) + open partial_pnl
    realized_closed = sum(p.get("pnl_usd") or 0 for p in closed)
    realized_partial = sum(p.get("partial_pnl_usd") or 0 for p in opn)
    unrealized = b.get("unrealized_pnl_usd") or 0.0
    entry_usd = 2.0 if st["cash"] + 1e-9 >= 250.0 else 1.0
    return {
        "start_usd": round(st["start"], 2),
        "free_cash_usd": round(st["cash"], 2),
        "open_principal_usd": round(st["open_cost"], 2),
        "realized_closed_pnl_usd": round(realized_closed, 2),
        "closed_net_pnl_usd": round(realized_closed, 2),  # alias: fully closed trades only (user "closed profits")
        "realized_partial_pnl_usd": round(realized_partial, 2),
        "partial_realized_pnl_usd": round(realized_partial, 2),  # alias: open positions' clipped/partial locks only
        "realized_net_pnl_usd": round(realized_closed + realized_partial, 2),
        "unrealized_open_pnl_usd": round(unrealized, 2),
        "account_value_marked_usd": round(b.get("equity_mark_to_market") or st["bankroll"], 2),
        "bankroll_realized_usd": round(st["bankroll"], 2),
        "dust": {
            "frac_pct": SX.DUST_FRAC * 100,
            "open_dust_mark_usd": round(dust_open, 2),
            "closed_dust_mark_usd": round(dust_closed_mark, 2),
            "realized_counts_dust_at": 0,
            "note": "realized PnL counts dust at zero; marked account value may include dust at last price via open marks",
        },
        "modeled_costs_usd": {
            "entry_drag_approx": round(entry_costs, 4),
            "clip_exit_drag_approx": round(clip_cost_drag, 4),
            "note": "from stored entry_cost fractions and clip_log; percent model",
            "fixed_fees_closed_usd": round(sum(float(p.get("fixed_fees_usd") or 0) for p in closed), 6),
            "fixed_fees_open_usd": round(sum(float(p.get("fixed_fees_usd") or 0) for p in opn), 6),
            "rent_locked_open_usd": round(sum(float(p.get("rent_locked_usd") or 0) for p in opn), 6),
            "rent_forfeited_closed_usd": round(sum(float(p.get("rent_forfeited_usd") or 0) for p in closed), 6),
        },
        "book_state_extras": {"rent_locked_usd": round(st.get("rent_locked_usd") or 0, 6),
                              "entry_fixed_fees_open_usd": round(st.get("entry_fixed_fees_open_usd") or 0, 6)},
        "sizing": {
            "mode": "fixed",
            "next_entry_usd": entry_usd,
            "tier2_requires_free_cash_usd": 250.0,
            "size_up_uses": "free_cash_usd only (start + realized_net - open_principal)",
            "size_up_ignores": ["account_value_marked_usd", "unrealized_open_pnl_usd", "dust marks", "external deposits"],
            "rule": "raise to $2 only when free_cash_usd >= 250 from own realized net after modeled costs; never from floating/marked equity",
            "max_open": 15,
            "max_open_notional_usd": 15.0,
            "reserve_cash_usd": 85.0,
            "sleeve_note": "at most $15 original open entry notional / 15 x $1; ~$85 cash reserve entries+fees may not spend; max_new_per_cycle still limits pace; fewer fills OK when fees shrink sleeve",
        },
        "trades_open": b.get("trades_open"),
        "trades_closed": b.get("trades_closed"),
        "losses_retained": True,
        "book": b,
    }


def _report(a):
    from .ledger import Ledger
    from .report import unreported
    from .engine import EXPERIMENT100_BOOK, iso_ct
    from . import costs as K
    db = _db(a)
    led = Ledger(db)
    acct = _account(led)
    out = {
        "experiment": "experiment100",
        "simulated": True,
        "live_trading": False,
        "db": db,
        "generated_at_ct": iso_ct(time.time()),
        "account": acct,
        # convenience aliases at top level for routines
        "free_cash_usd": acct["free_cash_usd"],
        "closed_net_pnl_usd": acct["closed_net_pnl_usd"],
        "partial_realized_pnl_usd": acct["partial_realized_pnl_usd"],
        "unrealized_open_pnl_usd": acct["unrealized_open_pnl_usd"],
        "realized_net_pnl_usd": acct["realized_net_pnl_usd"],
        "account_value_marked_usd": acct["account_value_marked_usd"],
        "next_entry_usd": acct["sizing"]["next_entry_usd"],
        "no_deposit_path": True,
        "live_trading": False,
        "exit_policy": "clip5_rug_dust (20% at 2x/3x/4x/6x, 15% at 10x, 5% dust; -50% pre-clip; rug 0.65x prior mark; trail max(entry,60% peak))",
        "filters": ["mcap_floor30k_20261109-v1: $30k mcap floor (same as proposed live executor); no upper cap; known mcap + $1k dead-FDV retained",
                    "mayhem skip/unknown skip", "bundle>=20% skip", "risk SKIP>=40 REDUCED>=35",
                    "momentum>=50 combined>=55", "price disagreement>25% hold", "StalkChain quality REQUIRED pre-entry",
                    "liq/vol/txn/dump prefilter + quote_sanity", "sleeve max15/$15/$85", "fixed fees ff20261105-v1"],
        "mcap_policy_version": "mcap_floor30k_20261109-v1",
        "cost_model": K.assumptions(),
        "fixed_fees": __import__("smr.paper.fixed_fees", fromlist=["drag_report"]).drag_report(
            __import__("smr.paper.fixed_fees", fromlist=["load"]).load()),
        "cost_model_caveat": COST_CAVEAT,
        "maintenance": _maintenance(db),
        "unreported_events": len(unreported(led, EXPERIMENT100_BOOK)),
    }
    if a.summary:
        print(f"experiment100 PAPER. free_cash ${acct['free_cash_usd']:.2f} | closed_net ${acct['closed_net_pnl_usd']:.2f} | "
              f"partial_realized ${acct['partial_realized_pnl_usd']:.2f} | unrealized_open ${acct['unrealized_open_pnl_usd']:.2f} | "
              f"marked_value ${acct['account_value_marked_usd']:.2f} | open {acct['trades_open']} closed {acct['trades_closed']} | "
              f"next_entry ${acct['sizing']['next_entry_usd']} (size-up on free_cash>=250 only, not marked).")
        print(COST_CAVEAT)
    else:
        print(json.dumps(out, indent=2, default=str))


def _status(a):
    """Combined daemon + account snapshot for the parent routine (every ~5 min)."""
    from . import scanner as S
    from . import watcher as W
    from .ledger import Ledger
    from .engine import iso_ct
    db = _db(a)
    led = Ledger(db)
    acct = _account(led)
    from . import fixed_fees as FF
    maint = _maintenance(db)
    out = {
        "experiment": "experiment100",
        "simulated": True,
        "live_trading": False,
        "at_ct": iso_ct(time.time()),
        "db": db,
        "maintenance": maint,
        "fixed_fees": FF.drag_report(FF.load()),
        "scanner": S.status(db),
        "watcher": W.status(db),
        "account": {
            "free_cash_usd": acct["free_cash_usd"],
            "closed_net_pnl_usd": acct["closed_net_pnl_usd"],
            "partial_realized_pnl_usd": acct["partial_realized_pnl_usd"],
            "realized_net_pnl_usd": acct["realized_net_pnl_usd"],
            "unrealized_open_pnl_usd": acct["unrealized_open_pnl_usd"],
            "account_value_marked_usd": acct["account_value_marked_usd"],
            "next_entry_usd": acct["sizing"]["next_entry_usd"],
            "trades_open": acct["trades_open"],
            "trades_closed": acct["trades_closed"],
            "size_up_uses": acct["sizing"]["size_up_uses"],
            "max_open": acct["sizing"].get("max_open"),
            "max_open_notional_usd": acct["sizing"].get("max_open_notional_usd"),
            "reserve_cash_usd": acct["sizing"].get("reserve_cash_usd"),
            "sleeve_note": acct["sizing"].get("sleeve_note"),
            "no_deposit_path": True,
            "live_trading": False,
        },
        "cost_model_caveat": COST_CAVEAT,
        "keepalive": "only data/experiment100/paper.db daemons; never start risk paper cycle or scanner/watcher on data/paper.db",
    }
    print(json.dumps(out, indent=2, default=str))
    if a.check and not (out["scanner"].get("healthy") and out["watcher"].get("healthy")):
        raise SystemExit(1)


def _events(a):
    from .ledger import Ledger
    from .report import unreported, mark_reported
    from .engine import EXPERIMENT100_BOOK
    led = Ledger(_db(a))
    ev = unreported(led, EXPERIMENT100_BOOK)
    if a.text:
        print("\n".join(e["text"] for e in ev) if ev else "No new experiment100 trades.")
    else:
        print(json.dumps({"count": len(ev), "book": EXPERIMENT100_BOOK, "events": ev,
                          "text": "\n".join(e["text"] for e in ev) or "No new experiment100 trades.",
                          "cost_model_caveat": COST_CAVEAT}, indent=2, default=str))
    if a.mark_reported and ev:
        n = mark_reported(led, [e["event_id"] for e in ev])
        print(f"[experiment100] marked {n} event(s) reported", file=sys.stderr)


def _holders(a):
    """Plan/ingest StalkChain token quality for experiment100 candidates BEFORE entry (routine runs MCP; this CLI only files).

    quality_plan_cache_20261106-v1.1: prioritize never-looked REDUCED runner>=60, skip sticky cached vetoes,
    enforce recommended_shared_reserve on the shared daily budget. Does not weaken veto thresholds.
    """
    from .ledger import Ledger
    from . import edge as EG
    from .engine import EXPERIMENT100_BOOK, iso_ct
    db = _db(a)
    led = Ledger(db)
    edge_path = os.path.join(EXP_DIR, "paper_edge.json")
    ec = EG.EdgeConfig.load(edge_path)
    now = time.time()
    if a.action == "plan":
        used = EG.calls_today(ec.smart, now)
        left = max(0, ec.smart.daily_call_budget - used)
        reserve = int(getattr(ec.holders, "recommended_shared_reserve", 3) or 0)
        # Prefer config veto_reserve if set; else recommended_shared_reserve so we do not burn the shared 30 dry.
        effective_reserve = max(int(ec.holders.veto_reserve or 0), reserve)
        allow = max(0, min(ec.holders.max_lookups_per_cycle, left - effective_reserve))
        sticky = int(getattr(ec.holders, "sticky_veto_skip_s", 0) or 0)
        prefer_new = bool(getattr(ec.holders, "prefer_never_looked", False))
        # Prefer current REDUCED / quality-missing high runners from recent candidates
        rows = led.q(
            """SELECT mint,
                      MAX(runner_score) AS rs,
                      MAX(mcap) AS mcap,
                      MAX(at) AS at,
                      SUM(CASE WHEN risk_decision='REDUCED' THEN 1 ELSE 0 END) AS n_reduced,
                      SUM(CASE WHEN reason LIKE '%stalkchain_quality_unavailable%' THEN 1 ELSE 0 END) AS n_qm,
                      SUM(CASE WHEN risk_decision='SKIP' OR reason LIKE 'risk SKIP%' THEN 1 ELSE 0 END) AS n_skip
               FROM scanner_candidates
               WHERE at > ? AND runner_score IS NOT NULL AND runner_score >= 50
               GROUP BY mint
               ORDER BY rs DESC
               LIMIT 80""",
            (now - 6 * 3600,),
        )
        cache = EG.HolderCache(ec.holders, now)
        want, skipped = [], []
        ranked = []
        for r in rows:
            mint = r["mint"]
            if led.one("SELECT 1 AS x FROM positions WHERE book=? AND mint=?", (EXPERIMENT100_BOOK, mint)):
                skipped.append({"mint": mint, "why": "already traded"}); continue
            if (r.get("n_skip") or 0) > 0 and (r.get("n_reduced") or 0) == 0:
                # pure SKIP history with no REDUCED — deprioritize; still allow if nothing else
                pass
            raw = cache.tokens.get(mint)
            if cache.fresh(mint):
                skipped.append({"mint": mint, "why": "fresh cache"}); continue
            if isinstance(raw, dict):
                age = now - (raw.get("fetched_ts") or 0)
                veto = EG.holder_veto(raw, ec.holders)
                if veto and sticky > 0 and 0 <= age <= sticky:
                    skipped.append({"mint": mint, "why": f"sticky_veto_skip ({int(age)}s<{sticky}s)", "veto": veto}); continue
                never = False
            else:
                never = True
                veto = None
            # priority: never looked + has REDUCED/qm signal + high runner
            pri = (
                0 if (prefer_new and never) else 1,
                0 if (r.get("n_reduced") or 0) > 0 or (r.get("n_qm") or 0) > 0 else 1,
                0 if (r.get("n_skip") or 0) == 0 else 1,
                -(r.get("rs") or 0),
            )
            ranked.append((pri, r, never))
        ranked.sort(key=lambda t: t[0])
        for pri, r, never in ranked:
            if len(want) >= allow:
                skipped.append({"mint": r["mint"], "why": "budget"}); continue
            want.append({**r, "never_looked": never})
        calls = [{
            "why": (
                f"experiment100 pre-entry quality (runner {round(r['rs'] or 0,1)}"
                + ("; NEVER looked" if r.get("never_looked") else "; refresh")
                + (f"; REDUCED x{int(r['n_reduced'])}" if r.get("n_reduced") else "")
                + (f"; qm x{int(r['n_qm'])}" if r.get("n_qm") else "")
                + ")"
            ),
            "server": "user-stalkchain",
            "tool": EG.QUALITY_TOOL,
            "arguments": {"token": r["mint"]},
            "save_to": f"<file {i+1}>",
            "mint": r["mint"],
            "runner": r.get("rs"),
        } for i, r in enumerate(want)]
        print(json.dumps({
            "experiment": "experiment100",
            "policy_version": "quality_plan_cache_20261106-v1.1",
            "budget": {
                "ledger_path": os.path.abspath(ec.smart.usage_file),
                "veto_log_path": os.path.abspath(ec.smart.veto_log),
                "cache_file": os.path.abspath(ec.holders.cache_file),
                "used_today": used,
                "daily_limit": ec.smart.daily_call_budget,
                "left": left,
                "effective_reserve": effective_reserve,
                "max_this_plan": allow,
                "veto_reserve_config": ec.holders.veto_reserve,
                "recommended_shared_reserve": reserve,
                "sticky_veto_skip_s": sticky,
                "cache_max_age_s": ec.holders.cache_max_age_s,
                "counting_rule": "calls_today = sum(calls) in ledger_path for day_ct=America/Chicago today + distinct (mint,minute) rows in veto_log_path for that day; ALL StalkChain tools share daily_limit",
                "tool": EG.QUALITY_TOOL,
            },
            "calls": calls,
            "skipped": skipped[:40],
            "skipped_counts": {
                "fresh_cache": sum(1 for s in skipped if s.get("why") == "fresh cache"),
                "sticky_veto": sum(1 for s in skipped if str(s.get("why", "")).startswith("sticky_veto")),
                "budget": sum(1 for s in skipped if s.get("why") == "budget"),
                "already_traded": sum(1 for s in skipped if s.get("why") == "already traded"),
            },
            "ingest_cmd": ".venv/bin/python -m risk experiment100 holders ingest --file FILE [FILE ...]",
            "ingest_response_shape": {
                "ingested": "int count ok",
                "file": "holder cache path written",
                "results": [{"ok": True, "mint": "base58", "holders": "int|null", "veto": "str|null", "text_flagged": "int"},
                            {"ok": False, "why": "str"}],
            },
            "usage_row_shape": {"ts": "unix", "day_ct": "YYYY-MM-DD America/Chicago", "tool": "stalkchain_token_quality", "calls": 1},
            "note": "Routine: for each calls[].arguments call user-stalkchain stalkchain_token_quality, save JSON, ingest. "
                    "Enforce shared daily_limit 30; keep recommended_shared_reserve free when other books may need lookups. "
                    "Prefer NEVER-looked REDUCED/qm runners; sticky veto skip avoids re-burning budget on unchanged rugs. "
                    "No entry without fresh clear quality. Do not overcall. Do NOT raise daily_limit.",
        }, indent=2, default=str))
        return
    # ingest
    if not a.file:
        raise SystemExit("holders ingest needs --file")
    objs = []
    for path in a.file:
        with open(path) as f:
            objs.append(json.load(f))
    out = EG.ingest_holders(objs, now, ec.holders)
    if not a.no_log:
        EG.log_usage(ec.smart.usage_file, EG.QUALITY_TOOL, now, len(a.file))
    print(json.dumps({"experiment": "experiment100", "policy_version": "quality_plan_cache_20261106-v1.1", **out}, indent=2, default=str))



def add_parser(sub):
    p = sub.add_parser("experiment100", help="isolated $100 paper experiment (own DB; never touches $1000 books; simulation only)")
    ps = p.add_subparsers(dest="exp_cmd", required=True)

    sc = ps.add_parser("scanner", help="5-min scanner -> experiment100 book")
    sc.add_argument("action", choices=["status", "start", "stop", "run", "once"])
    sc.add_argument("--interval", type=int, default=300)
    sc.add_argument("--check", action="store_true")
    sc.add_argument("--quiet", action="store_true")
    sc.add_argument("--db", default=DEFAULT_DB)
    sc.set_defaults(fn=_scanner)

    wt = ps.add_parser("watcher", help="60s exit watcher for experiment100 (clip5_rug_dust)")
    wt.add_argument("action", choices=["status", "start", "stop", "run", "once"])
    wt.add_argument("--interval", type=int, default=60)
    wt.add_argument("--gt-per-min", type=int, default=4)
    wt.add_argument("--check", action="store_true")
    wt.add_argument("--quiet", action="store_true")
    wt.add_argument("--db", default=DEFAULT_DB)
    wt.set_defaults(fn=_watcher)

    st = ps.add_parser("status", help="combined scanner+watcher+account snapshot (routine every 5 min)")
    st.add_argument("--check", action="store_true", help="exit 1 unless scanner and watcher healthy")
    st.add_argument("--db", default=DEFAULT_DB)
    st.set_defaults(fn=_status)

    rp = ps.add_parser("report", help="experiment100 cash / realized / unrealized / marked value")
    rp.add_argument("--summary", action="store_true")
    rp.add_argument("--db", default=DEFAULT_DB)
    rp.set_defaults(fn=_report)

    ev = ps.add_parser("events", help="experiment100 BUY/PARTIAL_SELL/SELL events only")
    ev.add_argument("--text", action="store_true")
    ev.add_argument("--mark-reported", action="store_true")
    ev.add_argument("--db", default=DEFAULT_DB)
    ev.set_defaults(fn=_events)

    hd = ps.add_parser("holders", help="pre-entry StalkChain token quality plan/ingest (routine runs MCP)")
    hd.add_argument("action", choices=["plan", "ingest"])
    hd.add_argument("--file", nargs="+", default=None)
    hd.add_argument("--no-log", action="store_true")
    hd.add_argument("--db", default=DEFAULT_DB)
    hd.set_defaults(fn=_holders)
