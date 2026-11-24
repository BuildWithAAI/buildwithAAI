"""Layered agent economy: paper scorecard, promotion-ladder stage eligibility, paper capital weights (see ECONOMY.md).

READ-ONLY and PAPER-ONLY. This module never writes to the store, never places or approves orders, and never moves
money. A computed stage is *eligibility*, not a grant: moving a strategy up the ladder is a human (Zoorped) decision,
and any stage that touches real money additionally needs Zoorped's explicit sign-off plus an L0 agent-guard approval
token per money movement. `real_money_allowed` is therefore always False here, by construction.

Strategy sources:
  * aai store (L2/L3): closed paper positions, keyed "aai:<sector>/<idea source>" (test artifacts excluded).
  * perps-pipeline arena (L1): closed simulated trades per arm from state/arena/arena.sqlite, opened read-only.
"""
from __future__ import annotations
import json, math, os, sqlite3, time

STAGES = {
    0: "human-run",
    1: "human-approved per action (paper)",
    2: "automatic within limits (paper)",
    3: "autonomous within limits (paper)",
}

# Entry criteria to *be eligible* for a stage (all must hold). Numbers are per-trade R multiples (pnl / planned risk).
LADDER = {
    1: {"min_trades": 10, "max_drawdown": 0.15, "min_expectancy_r": -0.05, "min_oos_trades": 0, "min_oos_expectancy_r": None,
        "min_profit_factor": None, "min_r_sharpe": None, "min_days": 0},
    2: {"min_trades": 30, "max_drawdown": 0.10, "min_expectancy_r": 0.10, "min_oos_trades": 10, "min_oos_expectancy_r": 0.0,
        "min_profit_factor": 1.2, "min_r_sharpe": 0.10, "min_days": 7},
    3: {"min_trades": 100, "max_drawdown": 0.08, "min_expectancy_r": 0.15, "min_oos_trades": 30, "min_oos_expectancy_r": 0.10,
        "min_profit_factor": 1.3, "min_r_sharpe": 0.15, "min_days": 30},
}
# Exit (auto-demotion) triggers, evaluated on top of entry eligibility.
EXIT = {"current_drawdown": {1: 0.15, 2: 0.10, 3: 0.08},   # drawdown from peak right now >= this -> demote one stage
        "recent_window": 20, "recent_min_expectancy_r": -0.25}  # last-N-trades expectancy below this -> demote one stage
OOS_FRACTION = 0.30          # last 30% of trades (chronological) are the out-of-sample window
MAX_WEIGHT = 0.40            # no single strategy gets more than 40% of the paper allocation
STAGE_MULT = {0: 0.0, 1: 0.5, 2: 1.0, 3: 1.5}


# ------------------------------------------------------------------ stats
def stats(trades: list[dict], capital: float) -> dict:
    """trades: [{"ts": close time, "pnl": net USD, "risk": planned risk USD or None, "r": R multiple or None}], any order."""
    tr = sorted((t for t in trades if isinstance(t.get("pnl"), (int, float))), key=lambda t: t.get("ts") or 0)
    rs = []
    for t in tr:
        r = t.get("r")
        if not isinstance(r, (int, float)) and isinstance(t.get("risk"), (int, float)) and t["risk"] > 0:
            r = t["pnl"] / t["risk"]
        if isinstance(r, (int, float)) and math.isfinite(r):
            rs.append(float(r))
    n = len(tr)
    pnl = sum(t["pnl"] for t in tr)
    wins = sum(1 for t in tr if t["pnl"] > 0)
    gross_win = sum(t["pnl"] for t in tr if t["pnl"] > 0)
    gross_loss = -sum(t["pnl"] for t in tr if t["pnl"] < 0)
    eq = peak = capital
    max_dd = 0.0
    for t in tr:
        eq += t["pnl"]
        peak = max(peak, eq)
        if peak > 0:
            max_dd = max(max_dd, (peak - eq) / peak)
    cur_dd = (peak - eq) / peak if peak > 0 else 0.0
    mean = lambda xs: sum(xs) / len(xs) if xs else None
    exp_r = mean(rs)
    sd_r = math.sqrt(sum((x - exp_r) ** 2 for x in rs) / (len(rs) - 1)) if len(rs) > 1 else None
    k = int(math.ceil(len(rs) * OOS_FRACTION)) if len(rs) >= 2 else 0
    oos = rs[-k:] if k else []
    risk_sum = sum(t["risk"] for t in tr if isinstance(t.get("risk"), (int, float)) and t["risk"] > 0)
    win = EXIT["recent_window"]
    ts = [t["ts"] for t in tr if t.get("ts")]
    rnd = lambda v, d=4: round(v, d) if isinstance(v, (int, float)) else v
    return {"trades": n, "wins": wins, "win_rate": rnd(wins / n if n else None), "net_pnl": rnd(pnl),
            "capital": capital, "return_pct": rnd(pnl / capital if capital else None),
            "max_drawdown": rnd(max_dd), "current_drawdown": rnd(cur_dd),
            "expectancy_r": rnd(exp_r), "sd_r": rnd(sd_r),
            "r_sharpe": rnd(exp_r / sd_r if exp_r is not None and sd_r else None),   # mean R / sd R, per trade
            "return_per_risk": rnd(pnl / risk_sum if risk_sum else exp_r),          # net P&L per $1 of planned risk
            "profit_factor": rnd(gross_win / gross_loss if gross_loss > 0 else (None if not gross_win else 999.0)),
            "oos_trades": len(oos), "oos_expectancy_r": rnd(mean(oos)),
            "recent_expectancy_r": rnd(mean(rs[-win:])) if len(rs) >= win else None,
            "days": rnd((max(ts) - min(ts)) / 86400 if len(ts) > 1 else 0.0, 2),
            "last_trade_ts": max(ts) if ts else None}


def _meets(s: dict, c: dict) -> list[str]:
    """Return the list of unmet entry criteria (empty = eligible)."""
    miss = []
    ge = lambda v, lim: isinstance(v, (int, float)) and v >= lim
    if s["trades"] < c["min_trades"]:
        miss.append(f"trades {s['trades']} < {c['min_trades']}")
    if not (s["max_drawdown"] <= c["max_drawdown"]):
        miss.append(f"max drawdown {s['max_drawdown']:.1%} > {c['max_drawdown']:.0%}")
    if c["min_expectancy_r"] is not None and not ge(s["expectancy_r"], c["min_expectancy_r"]):
        miss.append(f"expectancy {s['expectancy_r']}R < {c['min_expectancy_r']}R")
    if s["oos_trades"] < c["min_oos_trades"]:
        miss.append(f"out-of-sample trades {s['oos_trades']} < {c['min_oos_trades']}")
    oos_lim = c["min_oos_expectancy_r"]
    if oos_lim is not None and not (ge(s["oos_expectancy_r"], oos_lim) and s["oos_expectancy_r"] > 0):
        miss.append(f"out-of-sample expectancy {s['oos_expectancy_r']}R not above {c['min_oos_expectancy_r']}R")
    if c["min_profit_factor"] is not None and not ge(s["profit_factor"], c["min_profit_factor"]):
        miss.append(f"profit factor {s['profit_factor']} < {c['min_profit_factor']}")
    if c["min_r_sharpe"] is not None and not ge(s["r_sharpe"], c["min_r_sharpe"]):
        miss.append(f"R-sharpe {s['r_sharpe']} < {c['min_r_sharpe']}")
    if s["days"] < c["min_days"]:
        miss.append(f"track record {s['days']}d < {c['min_days']}d")
    return miss


def ladder(s: dict, killed: bool = False) -> dict:
    """Highest stage whose entry criteria all hold, then auto-demotion. Stages are cumulative: stage 2 needs stage 1."""
    eligible, blockers = 0, {}
    for st in (1, 2, 3):
        miss = _meets(s, LADDER[st])
        if miss:
            blockers[st] = miss
            break
        eligible = st
    demoted, reasons = eligible, []
    if killed:
        demoted, reasons = 0, ["kill switch / killed or benched arm"]
    elif eligible:
        lim = EXIT["current_drawdown"][eligible]
        if s["current_drawdown"] >= lim:
            reasons.append(f"current drawdown {s['current_drawdown']:.1%} >= {lim:.0%} stage-{eligible} exit")
        if s["recent_expectancy_r"] is not None and s["recent_expectancy_r"] < EXIT["recent_min_expectancy_r"]:
            reasons.append(f"last {EXIT['recent_window']} trades {s['recent_expectancy_r']}R < {EXIT['recent_min_expectancy_r']}R")
        if reasons:
            demoted = eligible - 1
    nxt = demoted + 1 if demoted < 3 else None
    return {"eligible_stage": eligible, "stage": demoted, "stage_name": STAGES[demoted], "demoted": demoted < eligible,
            "demotion_reasons": reasons, "next_stage": nxt,
            "next_stage_blockers": (blockers.get(nxt) or (_meets(s, LADDER[nxt]) if nxt else [])) if nxt else [],
            "requires_zoorped_signoff": True, "real_money_allowed": False}


# ------------------------------------------------------------------ allocation
def allocate(rows: list[dict], cap: float = MAX_WEIGHT) -> dict[str, float]:
    """Paper capital weights. Score = stage multiplier x positive expectancy x confidence(n/100), demoted halved.
    Stage 0, killed, or non-positive expectancy -> 0. Capped at `cap` each; leftover stays unallocated (cash)."""
    raw = {}
    for r in rows:
        s, l = r["stats"], r["ladder"]
        e = s["expectancy_r"] or 0.0
        score = STAGE_MULT[l["stage"]] * max(0.0, e) * min(1.0, s["trades"] / 100.0)
        if l["demoted"]:
            score *= 0.5
        raw[r["id"]] = score
    tot = sum(raw.values())
    w = {k: (v / tot if tot > 0 else 0.0) for k, v in raw.items()}
    for _ in range(len(w) + 1):   # water-fill: clip at cap, redistribute excess to uncapped positive weights
        over = {k: v for k, v in w.items() if v > cap + 1e-12}
        if not over:
            break
        excess = sum(v - cap for v in over.values())
        for k in over:
            w[k] = cap
        free = {k: v for k, v in w.items() if 0 < v < cap - 1e-12}
        fs = sum(free.values())
        if fs <= 0:
            break
        for k, v in free.items():
            w[k] = v + excess * v / fs
    return {k: round(min(v, cap), 6) for k, v in w.items()}


# ------------------------------------------------------------------ sources
def store_strategies(store) -> list[dict]:
    rows = store.query("""SELECT p.sector, COALESCE(i.source,'unknown') AS source, p.closed_at, p.realized_pnl, p.risk_usd
                          FROM positions p LEFT JOIN ideas i ON i.id = p.idea_id
                          WHERE p.status='closed' AND COALESCE(p.close_reason,'') <> 'test_artifact'""")
    by: dict = {}
    for r in rows:
        by.setdefault((r["sector"], r["source"]), []).append({"ts": r["closed_at"], "pnl": r["realized_pnl"] or 0.0, "risk": r["risk_usd"]})
    return [{"id": f"aai:{sec}/{src}", "layer": "L1->L3", "agent": src, "sector": sec, "origin": "aai store (paper ledger)",
             "trades": t, "killed": False} for (sec, src), t in sorted(by.items())]


def arena_strategies(root: str | None = None) -> list[dict]:
    """perps-pipeline arena arms (simulated $100 each). Read-only; missing files -> []."""
    root = root or os.path.join(os.environ.get("AAI_WORKSPACE", "/workspace"), "perps-pipeline")
    st_path, db = os.path.join(root, "state", "arena", "status.json"), os.path.join(root, "state", "arena", "arena.sqlite")
    try:
        status = json.load(open(st_path))
    except (OSError, ValueError):
        return []
    trades: dict = {}
    if os.path.exists(db):
        try:
            with sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=2) as c:
                for arm, xt, data in c.execute("SELECT arm, exit_time, data FROM trades WHERE status='closed'"):
                    try:
                        d = json.loads(data or "{}")
                    except ValueError:
                        d = {}
                    pnl, r = d.get("net_pnl"), d.get("r_multiple")
                    if isinstance(pnl, (int, float)):
                        risk = pnl / r if isinstance(r, (int, float)) and r else d.get("risk_amount")
                        trades.setdefault(arm, []).append({"ts": _ts(xt), "pnl": float(pnl), "r": r, "risk": risk})
        except sqlite3.Error:
            pass
    ks = bool((status.get("kill_switch") or {}).get("active")) or os.path.exists(os.path.join(root, "state", "KILL"))
    out = []
    for arm, v in sorted((status.get("arms") or {}).items()):
        v = v or {}
        out.append({"id": f"perps-arena:{arm}", "layer": "L1", "agent": "perps-pipeline", "sector": "perps",
                    "origin": "perps-pipeline arena (simulated)", "capital": float(v.get("initial") or 100.0),
                    "trades": trades.get(arm, []), "killed": ks or bool(v.get("killed")) or bool(v.get("benched"))})
    return out


def _ts(v):
    if isinstance(v, (int, float)):
        return v / 1000.0 if v > 1e11 else float(v)
    if isinstance(v, str):
        try:
            import datetime as dt
            return dt.datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return None
    return None


# ------------------------------------------------------------------ scorecard
def scorecard(store, cfg: dict, include_arena: bool = True, arena_root: str | None = None, now: float | None = None) -> dict:
    """Read-only per-strategy scorecard + ladder + paper allocation weights."""
    base = float(cfg["account"]["starting_equity_usd"])
    kill = (store.get_control("kill_switch", {"on": False}) or {}).get("on", False)
    strategies = store_strategies(store) + (arena_strategies(arena_root) if include_arena else [])
    rows = []
    for s in strategies:
        cap = s.get("capital") or base
        st = stats(s["trades"], cap)
        killed = s["killed"] or (kill and s["origin"].startswith("aai store"))
        rows.append({"id": s["id"], "layer": s["layer"], "agent": s["agent"], "sector": s["sector"], "origin": s["origin"],
                     "killed": killed, "stats": st, "ladder": ladder(st, killed)})
    w = allocate(rows)
    paper_capital = base
    for r in rows:
        r["weight"] = w.get(r["id"], 0.0)
        r["paper_allocation_usd"] = round(r["weight"] * paper_capital, 2)
    rows.sort(key=lambda r: (-r["ladder"]["stage"], -r["weight"], -(r["stats"]["expectancy_r"] or -1e9), r["id"]))
    from . import grants   # granted-stage registry (ECONOMY.md E2): read-only here, writes only via the CLI
    sc = {"strategies": rows}
    grants.annotate(sc, grants.current(store))
    return {"ok": True, "grants": sc["grants"], "mode": "paper", "generated_at": now or time.time(), "read_only": True,
            "real_money_allowed": False, "requires_zoorped_signoff_for_real_money": True,
            "global_kill": bool(kill), "paper_capital_usd": paper_capital,
            "unallocated_weight": round(max(0.0, 1.0 - sum(w.values())), 6),
            "stages": STAGES, "ladder_criteria": LADDER, "exit_criteria": EXIT, "max_weight": MAX_WEIGHT,
            "strategies": rows, "spec": "ECONOMY.md"}


# ------------------------------------------------------------------ HUD panel (ECONOMY.md E1)
_WORDS = ((" >= ", " at or above "), (" <= ", " at or below "), (" < ", " below "), (" > ", " above "))


def _words(t) -> str:
    """The agent_guard sanitiser strips '<' and '>' from display text, which would turn 'trades 2 < 10' into
    'trades 2 10'. Panel text spells comparisons out instead."""
    t = str(t)
    for a, b in _WORDS:
        t = t.replace(a, b)
    return t


def panel_rows(sc: dict) -> list[dict]:
    """One compact display row per strategy for the Zoora economy panel and the 'economy'/'ladder' intent.
    Pure function of a scorecard (read-only). flag: 'killed' (kill switch / killed or benched arm), 'demoted'
    (auto-demoted below its eligible stage) or None. Order follows the scorecard (stage, weight, expectancy)."""
    out = []
    for r in sc.get("strategies") or []:
        s, l, g = r.get("stats") or {}, r.get("ladder") or {}, r.get("grant") or {}
        blockers = l.get("next_stage_blockers") or []
        flag = "killed" if r.get("killed") else "demoted" if l.get("demoted") else None
        out.append({"id": r.get("id"), "agent": r.get("agent"), "sector": r.get("sector"), "origin": r.get("origin"),
                    "stage": l.get("stage", 0), "stage_name": l.get("stage_name") or STAGES.get(l.get("stage", 0)),
                    "eligible_stage": l.get("eligible_stage", 0), "next_stage": l.get("next_stage"),
                    "trades": s.get("trades", 0), "expectancy_r": s.get("expectancy_r"), "max_drawdown": s.get("max_drawdown"),
                    "current_drawdown": s.get("current_drawdown"), "weight": r.get("weight", 0.0),
                    "top_blocker": _words(blockers[0]) if blockers else None, "n_blockers": len(blockers),
                    "demotion_reasons": [_words(x) for x in l.get("demotion_reasons") or []], "flag": flag,
                    "killed": bool(r.get("killed")), "demoted": bool(l.get("demoted")),
                    "granted_stage": g.get("granted_stage", 0), "effective_stage": g.get("effective_stage", 0),
                    "grant_status": g.get("status", "none"), "granted_by": g.get("granted_by")})
    return out


def panel(sc: dict) -> dict:
    """Scorecard + compact rows + counts for the HUD. Still read-only, paper-only, real money locked."""
    rows = panel_rows(sc)
    by_stage = {st: sum(1 for r in rows if r["stage"] == st) for st in STAGES}
    return {**sc, "panel": rows,
            "summary": {"strategies": len(rows), "by_stage": by_stage,
                        "demoted": sum(1 for r in rows if r["flag"] == "demoted"),
                        "killed": sum(1 for r in rows if r["flag"] == "killed"),
                        "allocated_weight": round(sum(r["weight"] or 0.0 for r in rows), 6),
                        "unallocated_weight": sc.get("unallocated_weight"),
                        "granted": sum(1 for r in rows if (r["granted_stage"] or 0) > 0),
                        "pending_demotion": sum(1 for r in rows if r["grant_status"] == "pending_demotion"),
                        "eligible_above_grant": sum(1 for r in rows if r["grant_status"] == "eligible_above_grant")}}
