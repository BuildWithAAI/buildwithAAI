"""Read-only views of the other agents' pipelines on this computer, for the Zoora HUD.

Nothing here writes to another repo. SQLite files are opened with mode=ro, JSON reports are only read,
and heavy health checks run through each pipeline's own CLI in a background thread with a TTL cache, so
HTTP handlers never block on them. Missing files are reported as status='missing', never invented.
"""
from __future__ import annotations
import json, os, re, sqlite3, subprocess, threading, time
from datetime import datetime, timezone

WS = os.environ.get("AAI_WORKSPACE", "/workspace")
STALE_SEC = 48 * 3600
MINT_RE = re.compile(r"\b[1-9A-HJ-NP-Za-km-z]{32,44}\b")


def _p(*parts):
    return os.path.join(WS, *parts)


def _ts(v) -> float | None:
    """ISO-8601 string / epoch -> epoch seconds."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v) / (1000 if v > 1e12 else 1)
    try:
        s = str(v).replace("Z", "+00:00")
        d = datetime.fromisoformat(s)
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d.timestamp()
    except ValueError:
        return None


def _read_json(path):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _mtime(path):
    try:
        return os.path.getmtime(path)
    except OSError:
        return None


def _ro(path):
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=2)


def _fresh(ts, now=None):
    now = now or time.time()
    if ts is None:
        return {"ts": None, "age_sec": None, "stale": True}
    age = max(0.0, now - ts)
    return {"ts": ts, "age_sec": round(age), "stale": age > STALE_SEC}


# ---------------------------------------------------------------- cheap readers (files only, <50 ms)
def perps() -> dict:
    root = _p("perps-pipeline")
    st = _read_json(os.path.join(root, "state", "status", "status.json"))
    if st is None:
        return {"name": "perps-pipeline", "status": "missing", "detail": "state/status/status.json not found"}
    out = {"name": "perps-pipeline", "exchange": st.get("exchange"), "mode": st.get("mode"),
           "execution_enabled": bool(st.get("execution_enabled")), "generated_at": st.get("generated_at"),
           **_fresh(_ts(st.get("generated_at"))), "regime": st.get("regime") or {},
           "signals": [s for s in (st.get("signals") or []) if s.get("signal")],
           "n_signals_checked": len(st.get("signals") or []),
           "notes": ["Bybit public API is geo-blocked (HTTP 403) from this computer; Blofin is the live source."]}
    arena = _read_json(os.path.join(root, "state", "arena", "status.json"))
    if arena is not None:
        out.update(_arena(arena, root))
        out["signals"] = []  # status/status.json belongs to the archived legacy single-strategy runner
        out["notes"].append("Legacy single-strategy paper account archived 2026-11-03; arena arms replace it.")
        out["status"] = "stale" if out["stale"] else "ok"
        return out
    db = os.path.join(root, "state", "paper.sqlite")
    if os.path.exists(db):
        try:
            with _ro(db) as c:
                acct = dict(c.execute("SELECT key,value FROM account").fetchall())
                eq = c.execute("SELECT ts,equity,cash,unrealized FROM equity ORDER BY ts DESC LIMIT 1").fetchone()
                pos = [dict(zip(("id", "symbol", "side", "strategy", "timeframe", "opened_at", "entry", "data"), r)) for r in
                       c.execute("SELECT id,symbol,side,strategy,timeframe,opened_at,entry_price,data FROM positions WHERE status='open'")]
                closed = c.execute("SELECT COUNT(*), COALESCE(SUM(net_pnl),0) FROM positions WHERE status!='open'").fetchone()
            for p in pos:
                d = json.loads(p.pop("data") or "{}")
                p.update(side="long" if p["side"] == 1 else "short", stop=d.get("stop_price"), target=d.get("take_profit"),
                         notional=d.get("notional"), risk_usd=d.get("risk_amount"))
            killed = str(json.loads(acct.get("killed", "false"))).lower() == "true"
            out["paper"] = {"equity": eq and eq[1], "unrealized": eq and eq[3], "equity_ts": eq and eq[0],
                            "start_equity": 100.0, "open": pos, "closed_trades": closed[0], "realized": closed[1],
                            "killed": killed or os.path.exists(os.path.join(root, "state", "KILL")),
                            "kill_reason": json.loads(acct.get("kill_reason", '""')) or None}
        except (sqlite3.Error, ValueError) as e:
            out["paper"] = {"error": f"{type(e).__name__}: {e}"}
    out["status"] = "stale" if out["stale"] else "ok"
    return out


ARENA_CURVE_POINTS = 60
ARENA_TRADES = 8
ARENA_EVENTS = 6          # per arm, newest first, for the arm detail drawer
ARENA_EVENT_SCAN = 1500   # newest rows scanned (one busy arm can log far more than the others)
ARENA_EVENT_TEXT = 200


def _arena_history(db: str, points: int = ARENA_CURVE_POINTS, n_trades: int = ARENA_TRADES,
                   n_events: int = ARENA_EVENTS) -> dict:
    """Read-only: per-arm equity curve (downsampled to <= points, last point kept) and the latest closed trades
    from perps-pipeline's arena.sqlite, plus the newest `events` rows per arm (fills, orders, skips, kills). Missing or unreadable DB -> {} (the leaderboard still renders)."""
    if not os.path.exists(db):
        return {}
    out: dict = {}
    try:
        with _ro(db) as c:
            rows = c.execute("SELECT arm, ts, equity FROM equity ORDER BY arm, ts").fetchall()
            trades = c.execute("SELECT arm, symbol, entry_time, exit_time, data FROM trades WHERE status='closed' "
                               "ORDER BY exit_time DESC LIMIT 400").fetchall()
            try:  # optional table: older arena DBs have no events log
                events = c.execute("SELECT id, ts, arm, kind, message FROM events ORDER BY id DESC LIMIT ?",
                                   (ARENA_EVENT_SCAN,)).fetchall()
            except sqlite3.Error:
                events = []
    except sqlite3.Error:
        return {}
    by: dict = {}
    for arm, ts, eq in rows:
        t = _ts(ts)
        if t is not None and isinstance(eq, (int, float)):
            by.setdefault(arm, []).append([round(t), round(float(eq), 4)])
    for arm, pts in by.items():
        if len(pts) > points:
            step = len(pts) / (points - 1)
            pts = [pts[int(i * step)] for i in range(points - 1)] + [pts[-1]]
        out.setdefault(arm, {})["curve"] = pts
    for arm, sym, et, xt, data in trades:
        lst = out.setdefault(arm, {}).setdefault("trades", [])
        if len(lst) >= n_trades:
            continue
        try:
            d = json.loads(data or "{}")
        except ValueError:
            d = {}
        num = lambda k: d.get(k) if isinstance(d.get(k), (int, float)) else None
        lst.append({"symbol": sym, "side": {1: "long", -1: "short"}.get(d.get("side"), d.get("side")),
                    "entry_ts": _ts(et), "exit_ts": _ts(xt), "entry": num("entry_price"), "exit": num("exit_price"),
                    "net_pnl": num("net_pnl"), "r": num("r_multiple"), "exit_reason": d.get("exit_reason"),
                    "duration_min": num("duration_min"), "postmortem": _txt(d.get("postmortem")),
                    "thesis": _txt(d.get("thesis"))})
    # Repeated skips (e.g. "SOL-USDT short signal skipped: max concurrent 2" every 5-minute tick) are collapsed: within a
    # run of consecutive skip events for an arm, identical messages fold into one row with a count and a time span, so
    # fills, orders and kills stay visible in the drawer. Any non-skip event ends the run.
    runs: dict = {}   # arm -> {message: row} for the current skip run (newest-first scan)
    full: set = set()
    # `actions` is a second, skip-free list (newest non-skip events, same cap) for the drawer's "hide skips" filter, so
    # hiding skips shows up to n_events real fills/orders/kills instead of whatever survived the mixed 6-row cap.
    # `by_kind` is a third map (kind -> newest n_events of that kind) for the drawer's ORDER/OPEN/CLOSE/KILL chips.
    for eid, ts, arm, kind, msg in events:  # message only; the JSON `data` blob (thesis) is already shown elsewhere
        if not arm:
            continue
        k, m, t = _txt(kind, 24), _txt(msg, ARENA_EVENT_TEXT), _ts(ts)
        row = {"id": eid, "ts": t, "kind": k, "message": m, "count": 1, "first_ts": t}
        kl = str(k).lower() if k else "?"
        if kl != "skip":
            acts = out.setdefault(arm, {}).setdefault("actions", [])
            if len(acts) < n_events:
                acts.append(dict(row))
        bk = out.setdefault(arm, {}).setdefault("by_kind", {}).setdefault(kl, [])
        if len(bk) < n_events:
            bk.append(dict(row))
        if arm in full:
            continue
        lst = out.setdefault(arm, {}).setdefault("events", [])
        run = runs.setdefault(arm, {})
        if kl == "skip" and m in run:
            prev = run[m]
            prev["count"] += 1
            prev["first_ts"] = t if t is not None else prev["first_ts"]
            continue
        if len(lst) >= n_events:
            full.add(arm)
            continue
        lst.append(row)
        if kl == "skip":
            run[m] = row
        else:
            runs[arm] = {}
    return out


ARENA_TEXT_MAX = 600


def _txt(v, n: int = ARENA_TEXT_MAX):
    """Free text written by another agent (thesis/postmortem): plain str, capped. agent_guard sanitises it again
    before it reaches the browser, and the client only ever renders it as textContent."""
    if v is None:
        return None
    if not isinstance(v, str):
        v = json.dumps(v, default=str) if isinstance(v, (dict, list)) else str(v)
    v = " ".join(v.split())
    return v[:n] + ("…" if len(v) > n else "") or None


def _arena_resting(a: dict) -> list:
    """Resting (unfilled, simulated) limit orders from the arena status, one row per order. Read-only."""
    out = []
    for o in a.get("resting_orders") or []:
        if not isinstance(o, dict):
            continue
        exp = o.get("expires_ms")
        out.append({"id": o.get("id"), "arm": o.get("arm"), "symbol": o.get("symbol"),
                    "side": {1: "long", -1: "short"}.get(o.get("side"), o.get("side")),
                    "limit": o.get("limit_price") if isinstance(o.get("limit_price"), (int, float)) else None,
                    "created_ts": _ts(o.get("created")),
                    "expires_ts": exp / 1000.0 if isinstance(exp, (int, float)) else None})
    return out


def _arena(a: dict, root: str) -> dict:
    """perps-pipeline 'arena' (since 2026-11-03): several strategy arms, each its own $100 simulation."""
    arms = []
    for k, v in (a.get("arms") or {}).items():
        v = v or {}
        arms.append({"id": k, "equity": v.get("equity"), "initial": v.get("initial"), "open": v.get("open_trades"),
                     "closed": v.get("closed_trades"), "win_rate": v.get("win_rate"), "expectancy_r": v.get("expectancy_r"),
                     "drawdown_pct": v.get("drawdown_pct"), "killed": bool(v.get("killed")), "benched": bool(v.get("benched")),
                     "return_pct": v.get("return_pct"), "net_pnl": v.get("net_pnl"), "wins": v.get("wins"), "losses": v.get("losses"),
                     "kill_reason": v.get("kill_reason") or None})
    arms.sort(key=lambda x: (x["killed"], -(x["equity"] if isinstance(x["equity"], (int, float)) else -1e18)))
    hist = _arena_history(os.path.join(root, "state", "arena", "arena.sqlite"))
    for x in arms:
        h = hist.get(x["id"]) or {}
        x["curve"], x["trades"], x["events"] = h.get("curve") or [], h.get("trades") or [], h.get("events") or []
        x["actions"] = h.get("actions") or []
        x["by_kind"] = h.get("by_kind") or {}
    resting = _arena_resting(a)
    opens = []
    for t in a.get("open_positions") or []:
        opens.append({"id": t.get("id"), "arm": t.get("arm"), "symbol": t.get("symbol"),
                      "side": {1: "long", -1: "short"}.get(t.get("side"), t.get("side")), "entry": t.get("entry_price"),
                      "stop": t.get("stop_price"), "target": t.get("take_profit"), "opened_at": t.get("entry_time"),
                      "unrealized": t.get("unrealized"), "thesis": _txt(t.get("thesis"))})
    for x in arms:  # per-arm detail drawer: what this arm has on right now
        x["open_trades"] = [o for o in opens if o.get("arm") == x["id"]]
        x["resting"] = [o for o in resting if o.get("arm") == x["id"]]
    ks = a.get("kill_switch") or {}
    num = lambda xs: sum(x for x in xs if isinstance(x, (int, float)))
    quotes = {sym: (d.get("quote") or {}).get("last") for sym, d in (a.get("data") or {}).items() if isinstance(d, dict)}
    return {"generated_at": a.get("generated"), **_fresh(_ts(a.get("generated"))), "mode": a.get("mode"),
            "execution_enabled": False, "quotes": quotes,
            "paper": {"kind": "arena", "arms": arms, "equity": num(x["equity"] for x in arms),
                      "start_equity": num(x["initial"] for x in arms), "open": opens,
                      "resting_orders": len(resting),
                      "closed_trades": num(x["closed"] for x in arms), "unrealized": num(o["unrealized"] for o in opens),
                      "killed": bool(ks.get("active")) or os.path.exists(os.path.join(root, "state", "KILL")),
                      "kill_reason": "; ".join(map(str, ks.get("reasons") or [])) or None,
                      "tick_status": (a.get("tick") or {}).get("status"),
                      "tick_errors": len((a.get("tick") or {}).get("errors") or [])}}


def forex() -> dict:
    root = _p("aai-forex")
    rep = _read_json(os.path.join(root, "reports", "latest_scan.json"))
    if rep is None:
        return {"name": "aai-forex", "status": "missing", "detail": "reports/latest_scan.json not found"}
    scan = rep.get("scan") or {}
    ms = scan.get("market_state") or []
    out = {"name": "aai-forex", "mode": rep.get("mode"), "live_trading": bool(rep.get("live_trading")),
           "generated_at": rep.get("generated_at"), **_fresh(_ts(rep.get("generated_at"))),
           "signals": scan.get("signals") or [],
           "bias": [{"pair": m.get("pair"), "tf": m.get("tf"), "strategy": m.get("strategy"), "bias": m.get("bias"),
                     "close": m.get("close"), "last_bar": m.get("last_bar_close")} for m in ms if m.get("strategy") == "trend_swing"],
           "risk_limits": rep.get("risk_limits") or {},
           "kill_switch": os.path.exists(os.path.join(root, "state", "KILL_SWITCH"))}
    eq = []
    pdir = os.path.join(root, "state", "paper")
    for fn in sorted(os.listdir(pdir)) if os.path.isdir(pdir) else []:
        d = _read_json(os.path.join(pdir, fn)) or {}
        b = d.get("broker") or {}
        eq.append({"book": fn[:-5], "equity": d.get("equity"), "open": len(b.get("positions") or []),
                   "pending": len(b.get("pending") or [])})
    out["paper"] = eq
    out["status"] = "stale" if out["stale"] else "ok"
    return out


def billy() -> dict:
    root = _p("billy-pipeline")
    sig = _read_json(os.path.join(root, "reports", "signals_today.json"))
    if sig is None:
        return {"name": "billy-pipeline", "status": "missing", "detail": "reports/signals_today.json not found"}
    st = _read_json(os.path.join(root, "data", "state.json")) or {}
    cands = [{k: c.get(k) for k in ("asset", "side", "status", "rule", "tier", "trigger_level", "entry_ref", "stop", "target",
                                    "rr", "risk_pct", "last_price", "actionable", "rejected", "url", "post_ts")}
             for c in sig.get("candidates") or []]
    return {"name": "billy-pipeline", "generated_at": sig.get("generated_at"), **_fresh(_ts(sig.get("generated_at"))),
            "candidates": cands, "example_only": sig.get("EXAMPLE_ONLY"), "last_post_ts": st.get("last_post_ts"),
            "last_ingest": st.get("last_ingest_run_utc"), "total_posts": st.get("total_posts"),
            "status": "stale" if _fresh(_ts(sig.get("generated_at")))["stale"] else "ok"}


def security() -> dict:
    root = _p("security-pipeline")
    al = _read_json(os.path.join(root, "out", "alerts_latest.json"))
    if al is None:
        return {"name": "security-pipeline", "status": "missing", "detail": "out/alerts_latest.json not found"}
    items = []
    for a in al.get("alerts") or []:
        items.append({"tier": a.get("tier"), "title": a.get("title"), "entity": a.get("entity"), "category": a.get("category"),
                      "loss_usd": a.get("loss_usd"), "severity": a.get("severity"), "relevance": a.get("relevance"),
                      "matched_exposure": a.get("matched_exposure") or [], "status": a.get("status"),
                      "latest_utc": a.get("latest_utc"), "url": ((a.get("links") or [{}])[0]).get("url"),
                      "n_sources": len(a.get("sources") or [])})
    items.sort(key=lambda x: ({"CRITICAL": 0, "HIGH": 1}.get(x["tier"], 2), -(x["relevance"] or 0), -(x["severity"] or 0)))
    ts = _ts(al.get("generated_utc"))
    return {"name": "security-pipeline", "generated_at": al.get("generated_utc"), **_fresh(ts), "window": al.get("window"),
            "min_tier": al.get("min_tier"), "counts": al.get("counts") or {}, "alerts": items,
            "wallet_alerts": len(al.get("wallet_alerts") or []), "failed_sources": al.get("failed_sources") or [],
            "status": "stale" if _fresh(ts)["stale"] else "ok"}


def agent_guard() -> dict:
    root = _p("agent-guard")
    kill = os.environ.get("AGENT_GUARD_KILL_FILE") or os.path.join(root, "state", "KILL_SWITCH")
    md = os.path.join(root, "reports", "latest.md")
    out = {"name": "agent-guard", "global_kill_switch": os.path.exists(kill), **_fresh(_mtime(md))}
    try:
        with open(md) as f:
            head = f.read(4000)
        m = re.search(r"Summary:\s*\{([^}]*)\}", head)
        out["summary"] = {k: int(v) for k, v in re.findall(r"'(\w+)':\s*(\d+)", m.group(1))} if m else {}
        out["highs"] = [l[2:].strip() for l in head.splitlines() if l.startswith("- HIGH") or l.startswith("- CRITICAL")][:5]
        out["status"] = "stale" if out["stale"] else "ok"
    except OSError:
        out.update(status="missing", detail="reports/latest.md not readable")
    return out


def smr_local() -> dict:
    """Cheap facts about solana-meme-risk (no network): repo present + funding graph db freshness."""
    root = _p("solana-meme-risk")
    db = os.path.join(root, "data", "funding_graph.db")
    return {"name": "solana-meme-risk", "present": os.path.isdir(root), "funding_graph_db": os.path.exists(db),
            **_fresh(_mtime(db))}


CHEAP = {"perps": perps, "forex": forex, "billy": billy, "security": security, "agent_guard": agent_guard, "smr_local": smr_local}


def cheap_all() -> dict:
    out = {}
    for k, fn in CHEAP.items():
        try:
            out[k] = fn()
        except Exception as e:  # a broken reader must never break the HUD
            out[k] = {"name": k, "status": "error", "detail": f"{type(e).__name__}: {e}"}
    return out


# ---------------------------------------------------------------- heavy checks (subprocess, 15-40 s) with TTL cache
def _run_json(cmd, cwd, timeout):
    t = time.time()
    try:
        p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"ok": False, "status": "error", "detail": f"{type(e).__name__}: {e}", "ms": int((time.time() - t) * 1000)}
    try:
        rep = json.loads(p.stdout)
    except ValueError:
        return {"ok": False, "status": "error", "detail": f"exit {p.returncode}; non-JSON output: {(p.stderr or p.stdout)[-300:]}",
                "ms": int((time.time() - t) * 1000)}
    checks = rep.get("checks") or []
    failed = [{"check": c.get("check"), "required": c.get("required"),
               "detail": (c.get("detail") if isinstance(c.get("detail"), str) else json.dumps(c.get("detail"))[:240])}
              for c in checks if not c.get("pass")]
    return {"ok": rep.get("overall") == "pass", "status": rep.get("overall"), "provider": rep.get("provider"),
            "n_checks": len(checks), "failed": failed, "ms": int((time.time() - t) * 1000)}


def smr_health():
    """solana-meme-risk's own `health --quick` (its text is untrusted). Summarised with the same rules as
    `aai healthcheck` (SolanaMemeAdapter): required failures, passed/total, and pump.fun HTTP 403 / circuit open as an
    upstream block. The block is shown as DEGRADED, never bypassed; any other required failure is FAIL."""
    from .adapters.solana_meme import UPSTREAM_NOTE, upstream_blocked_checks
    root = _p("solana-meme-risk")
    py = os.path.join(root, ".venv", "bin", "python")
    rep = _run_json([py if os.path.exists(py) else "python3", "-m", "risk", "health", "--quick"], root, 120)
    failed = rep.get("failed", [])
    req = [str(f.get("check"))[:60] for f in failed if f.get("required")]
    blocked = upstream_blocked_checks(failed)
    if isinstance(rep.get("n_checks"), int):
        rep["passed"], rep["total"] = rep["n_checks"] - len(failed), rep["n_checks"]
    rep["failed_required"] = req
    if blocked:
        rep["upstream_blocked"] = {"source": "pump.fun", "checks": blocked, "note": UPSTREAM_NOTE}
    breaker = [f for f in failed if "pumpfun" in (f.get("check") or "")]
    other_req = [c for c in req if c not in blocked]
    if breaker:
        rep["degraded_reason"] = ("pump.fun API returns HTTP 403 (Cloudflare block). Not bypassed by design; "
                                  "scores run on RPC + DexScreener with reduced pump.fun coverage.") if blocked else \
            "pump.fun checks failing (" + ", ".join(str(f.get("check")) for f in breaker) + ")"
        rep["state"] = "FAIL" if other_req else "DEGRADED"
    else:
        rep["state"] = "OK" if rep.get("ok") else "FAIL"
    return rep


def core_health():
    root = _p("aai-core")
    py = os.path.join(root, ".venv", "bin", "python")
    rep = _run_json([py if os.path.exists(py) else "python3", "-m", "aai", "health", "--quick", "--no-smr", "--no-tests"], root, 120)
    # Same facts as the meme-risk row: passed/total and required vs optional failures (aai-core's text is untrusted).
    failed = rep.get("failed", [])
    rep["failed_required"] = [str(f.get("check"))[:60] for f in failed if f.get("required")]
    rep["failed_optional"] = [str(f.get("check"))[:60] for f in failed if not f.get("required")]
    if isinstance(rep.get("n_checks"), int):
        rep["passed"], rep["total"] = rep["n_checks"] - len(failed), rep["n_checks"]
    rep["state"] = "OK" if rep.get("ok") else ("DEGRADED" if rep.get("status") == "fail" else "FAIL")
    return rep


class HeavyCache:
    """Runs slow health checks in a daemon thread; readers get the last result instantly."""

    def __init__(self, jobs: dict, ttl: float = 600.0):
        self.jobs, self.ttl = jobs, ttl
        self.data = {k: {"state": "PENDING", "checked_at": None} for k in jobs}
        self.running: set[str] = set()
        self.lock = threading.Lock()

    def _run(self, k):
        try:
            res = self.jobs[k]()
        except Exception as e:
            res = {"ok": False, "state": "FAIL", "detail": f"{type(e).__name__}: {e}"}
        res["checked_at"] = time.time()
        with self.lock:
            self.data[k] = res
            self.running.discard(k)

    def refresh(self, force: bool = False) -> list[str]:
        started = []
        now = time.time()
        with self.lock:
            for k in self.jobs:
                ca = self.data[k].get("checked_at")
                if k in self.running or (not force and ca and now - ca < self.ttl):
                    continue
                self.running.add(k)
                started.append(k)
        for k in started:
            threading.Thread(target=self._run, args=(k,), daemon=True, name=f"zoora-heavy-{k}").start()
        return started

    def snapshot(self, kick: bool = True) -> dict:
        if kick:
            self.refresh()
        with self.lock:
            return {"ttl_sec": self.ttl, "running": sorted(self.running),
                    "checks": {k: {**v, "age_sec": round(time.time() - v["checked_at"]) if v.get("checked_at") else None}
                               for k, v in self.data.items()}}


HEAVY_JOBS = {"solana_meme_risk": smr_health, "aai_core": core_health}
