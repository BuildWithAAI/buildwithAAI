"""Daily economy snapshot + stage-change feed (ECONOMY.md E6). PAPER ONLY.

Once per Chicago calendar day the paper scorecard (aai/economy.py) is compacted and appended to `economy_snapshots`.
Each snapshot is diffed against the previous one; every change in a strategy's ladder position becomes a row in
`economy_stage_events` (both tables append-only, DB triggers forbid UPDATE/DELETE). Before diffing, the snapshot runs
`grants.reconcile()` so a granted stage that sits above current eligibility is demoted in the sign-off log without a
human remembering to run `aai economy-reconcile`.

Writers: the human CLI (`aai economy-snapshot`) and the `aai hud` server's once-a-day scheduler thread. Reads (the HUD
API, the Zoora panel and intents) never write. Nothing here can raise a stage, grant, size or trade: demotions only move
toward safety, and eligibility changes are reported for a human to act on with `aai economy-grant`.
"""
from __future__ import annotations
import datetime as _dt, json, time
from zoneinfo import ZoneInfo
from . import audit, economy, grants

TZ = ZoneInfo("America/Chicago")
DUE_HOUR = 7                      # scheduler takes the day's snapshot at/after 07:00 CT
WRITERS = ("cli", "scheduler")
SEV = {"demoted": "high", "killed": "high", "grant_demoted": "high", "promoted": "warn",
       "revived": "info", "new": "info", "removed": "info", "granted": "info"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS economy_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts REAL NOT NULL,
  day TEXT NOT NULL,
  actor TEXT NOT NULL,
  n INTEGER NOT NULL,
  payload TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS economy_snapshots_day ON economy_snapshots(day, id);
CREATE TRIGGER IF NOT EXISTS economy_snapshots_no_update BEFORE UPDATE ON economy_snapshots
  BEGIN SELECT RAISE(ABORT, 'economy_snapshots is append-only'); END;
CREATE TRIGGER IF NOT EXISTS economy_snapshots_no_delete BEFORE DELETE ON economy_snapshots
  BEGIN SELECT RAISE(ABORT, 'economy_snapshots is append-only'); END;
CREATE TABLE IF NOT EXISTS economy_stage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts REAL NOT NULL,
  day TEXT NOT NULL,
  snapshot_id INTEGER NOT NULL,
  strategy TEXT NOT NULL,
  kind TEXT NOT NULL,
  from_stage INTEGER,
  to_stage INTEGER,
  detail TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS economy_stage_events_ts ON economy_stage_events(id);
CREATE TRIGGER IF NOT EXISTS economy_events_no_update BEFORE UPDATE ON economy_stage_events
  BEGIN SELECT RAISE(ABORT, 'economy_stage_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS economy_events_no_delete BEFORE DELETE ON economy_stage_events
  BEGIN SELECT RAISE(ABORT, 'economy_stage_events is append-only'); END;
"""


class SnapshotError(ValueError):
    pass


def ensure(store) -> None:
    with store._lock:
        store.conn.executescript(SCHEMA)


def day_of(ts: float | None = None) -> str:
    return _dt.datetime.fromtimestamp(ts if ts is not None else time.time(), TZ).strftime("%Y-%m-%d")


def compact(sc: dict) -> dict[str, dict]:
    """Pure: the fields a stage history needs, keyed by strategy id."""
    out = {}
    for r in sc.get("strategies") or []:
        s, l, g = r.get("stats") or {}, r.get("ladder") or {}, r.get("grant") or {}
        out[r["id"]] = {"stage": int(l.get("stage", 0)), "eligible_stage": int(l.get("eligible_stage", 0)),
                        "granted_stage": int(g.get("granted_stage", 0)), "effective_stage": int(g.get("effective_stage", 0)),
                        "killed": bool(r.get("killed")), "demoted": bool(l.get("demoted")),
                        "trades": int(s.get("trades") or 0), "expectancy_r": s.get("expectancy_r"),
                        "current_drawdown": s.get("current_drawdown"), "weight": r.get("weight", 0.0),
                        "reasons": [economy._words(x) for x in (l.get("demotion_reasons") or [])][:3]}
    return out


def diff(prev: dict[str, dict] | None, cur: dict[str, dict]) -> list[dict]:
    """Pure: stage-change events between two compact snapshots. No previous snapshot -> no events (baseline day)."""
    if prev is None:
        return []
    ev = []

    def add(sid, kind, a, b, detail):
        ev.append({"strategy": sid, "kind": kind, "from_stage": a, "to_stage": b, "detail": detail, "sev": SEV[kind]})
    for sid, c in cur.items():
        p = prev.get(sid)
        if p is None:
            add(sid, "new", None, c["stage"], f"new strategy at S{c['stage']} ({c['trades']} trades)")
            continue
        if c["killed"] and not p.get("killed"):
            add(sid, "killed", p["stage"], c["stage"], "kill switch / killed or benched arm")
        elif p.get("killed") and not c["killed"]:
            add(sid, "revived", p["stage"], c["stage"], "no longer killed or benched")
        if c["stage"] > p["stage"]:
            add(sid, "promoted", p["stage"], c["stage"],
                f"now eligible for S{c['stage']}; promotion still needs a human `aai economy-grant` (paper only)")
        elif c["stage"] < p["stage"] and not (c["killed"] and not p.get("killed")):
            add(sid, "demoted", p["stage"], c["stage"], "; ".join(c.get("reasons") or []) or "no longer meets the stage criteria")
        if c["granted_stage"] > p.get("granted_stage", 0):
            add(sid, "granted", p.get("granted_stage", 0), c["granted_stage"], "human grant recorded (paper)")
        elif c["granted_stage"] < p.get("granted_stage", 0):
            add(sid, "grant_demoted", p.get("granted_stage", 0), c["granted_stage"], "granted stage lowered (revoke or auto-demotion)")
    for sid, p in prev.items():
        if sid not in cur:
            add(sid, "removed", p["stage"], None, "strategy no longer reported")
    return ev


def latest(store) -> dict | None:
    try:
        r = store.one("SELECT * FROM economy_snapshots ORDER BY id DESC LIMIT 1")
    except Exception:
        return None
    if not r:
        return None
    return {**r, "payload": json.loads(r["payload"])}


def due(store, now: float | None = None) -> bool:
    now = now if now is not None else time.time()
    if _dt.datetime.fromtimestamp(now, TZ).hour < DUE_HOUR:
        return False
    last = latest(store)
    return not last or last["day"] != day_of(now)


def take(store, cfg: dict, *, actor: str = "cli", force: bool = False, now: float | None = None,
         sc_fn=None) -> dict:
    """Append today's snapshot (once per CT day unless force) and its stage-change events. Paper only, never promotes."""
    if actor not in WRITERS:
        raise SnapshotError(f"actor {actor!r} cannot write economy snapshots")
    now = now if now is not None else time.time()
    day = day_of(now)
    ensure(store)
    last = latest(store)
    if last and last["day"] == day and not force:
        return {"ok": True, "skipped": True, "reason": f"snapshot for {day} already taken", "snapshot_id": last["id"]}
    sc_fn = sc_fn or (lambda: economy.scorecard(store, cfg))
    rec = grants.reconcile(store, cfg, actor=actor, sc=sc_fn())
    cur = compact(sc_fn())
    events = diff(last["payload"] if last else None, cur)
    sid = store.execute("INSERT INTO economy_snapshots(ts,day,actor,n,payload) VALUES(?,?,?,?,?)",
                        (now, day, actor, len(cur), json.dumps(cur, default=str))).lastrowid
    for e in events:
        store.execute("""INSERT INTO economy_stage_events(ts,day,snapshot_id,strategy,kind,from_stage,to_stage,detail)
                         VALUES(?,?,?,?,?,?,?,?)""", (now, day, sid, e["strategy"], e["kind"], e["from_stage"],
                                                      e["to_stage"], str(e["detail"])[:500]))
    audit.record(store, "economy_snapshot", actor=actor, ref=day,
                 inputs={"strategies": len(cur), "baseline": last is None, "force": bool(force)},
                 outcome=f"{len(events)} stage events",
                 reasons=[f"{e['strategy']} {e['kind']}" for e in events][:20] + ["paper only; snapshots never promote"])
    return {"ok": True, "skipped": False, "snapshot_id": sid, "day": day, "strategies": len(cur),
            "baseline": last is None, "events": events, "auto_demotions": rec.get("demotions", []), "paper_only": True}


def events(store, n: int = 20, since: float | None = None) -> list[dict]:
    try:
        q, p = "SELECT * FROM economy_stage_events", ()
        if since is not None:
            q, p = q + " WHERE ts >= ?", (float(since),)
        rows = store.query(q + " ORDER BY id DESC LIMIT ?", p + (int(n),))
    except Exception:
        return []
    for r in rows:
        r["sev"] = SEV.get(r["kind"], "info")
    return rows


SERIES_MAX_DAYS = 60


def _num(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and v == v else None


def _gap_info(day_list: list[str], now: float | None) -> dict:
    """Pure: calendar days with no snapshot (backlog P3 "Economy snapshot gap note"), so a gap is never read as a flat week.
    `gap_before[i]` = days skipped right before day_list[i]; `missing_days` = every skipped day between the first and last
    snapshot day of the window; `overdue_days` = days since the last snapshot whose snapshot was already due (today only
    counts from DUE_HOUR CT on)."""
    if not day_list:
        return {"gap_before": [], "missing_days": [], "n_missing": 0, "span_days": 0, "overdue_days": 0}
    ds = [_dt.date.fromisoformat(d) for d in day_list]
    gap_before = [0] + [max(0, (b - a).days - 1) for a, b in zip(ds, ds[1:])]
    missing = [(a + _dt.timedelta(days=k)).isoformat() for a, b in zip(ds, ds[1:]) for k in range(1, (b - a).days)]
    t = _dt.datetime.fromtimestamp(now if now is not None else time.time(), TZ)
    last_due = t.date() if t.hour >= DUE_HOUR else t.date() - _dt.timedelta(days=1)
    return {"gap_before": gap_before, "missing_days": missing, "n_missing": len(missing),
            "span_days": (ds[-1] - ds[0]).days + 1, "overdue_days": max(0, (last_due - ds[-1]).days)}


def series(store, days: int = 14, now: float | None = None) -> dict:
    """Read-only per-strategy stage history (backlog P3 "Stage history sparkline").

    Uses the newest snapshot of each CT day (a forced re-take replaces that day's earlier one), the last `days` days,
    oldest first. A strategy missing from a day gets `None` there (a gap, never an invented value). Per strategy:
    `points` aligned to `days` plus a summary: first/last stage, max stage, number of stage changes, killed days and
    the expectancy-R / trade-count change across the window. Gap fields (`gap_before`, `missing_days`, `n_missing`,
    `span_days`, `overdue_days`) say which calendar days have no snapshot at all (HUD down). Never writes, never grants."""
    days = max(1, min(SERIES_MAX_DAYS, int(days)))
    try:
        rows = store.query("SELECT id,day,payload FROM economy_snapshots ORDER BY id DESC LIMIT ?", (days * 4,))
    except Exception:
        rows = []
    per_day: dict[str, dict] = {}
    for r in rows:                                    # newest first: the first row seen for a day wins
        if r["day"] not in per_day:
            try:
                per_day[r["day"]] = json.loads(r["payload"])
            except (TypeError, ValueError):
                continue
    day_list = sorted(per_day)[-days:]
    ids = sorted({sid for d in day_list for sid in per_day[d]})
    out = {}
    for sid in ids:
        pts = []
        for d in day_list:
            v = per_day[d].get(sid)
            pts.append(None if v is None else {
                "day": d, "stage": int(v.get("stage", 0)), "granted_stage": int(v.get("granted_stage", 0)),
                "effective_stage": int(v.get("effective_stage", 0)), "killed": bool(v.get("killed")),
                "trades": int(v.get("trades") or 0), "expectancy_r": _num(v.get("expectancy_r")),
                "current_drawdown": _num(v.get("current_drawdown"))})
        have = [p for p in pts if p]
        st = [p["stage"] for p in have]
        er = [p["expectancy_r"] for p in have if p["expectancy_r"] is not None]
        out[sid] = {"points": pts, "n": len(have),
                    "first_stage": st[0], "last_stage": st[-1], "max_stage": max(st),
                    "stage_changes": sum(1 for a, b in zip(st, st[1:]) if a != b),
                    "killed_days": sum(1 for p in have if p["killed"]),
                    "expectancy_first": er[0] if er else None, "expectancy_last": er[-1] if er else None,
                    "expectancy_delta": round(er[-1] - er[0], 4) if len(er) >= 2 else None,
                    "trades_delta": have[-1]["trades"] - have[0]["trades"] if len(have) >= 2 else None}
    return {"days": day_list, "n_days": len(day_list), "strategies": out, **_gap_info(day_list, now)}


def history(store, n: int = 30, series_days: int | None = None) -> dict:
    """Read-only: recent events + per-day stage counts for the HUD feed and `aai economy-events`.
    With `series_days`, also the per-strategy stage/expectancy history (`series`) for the economy panel sparklines."""
    try:
        snaps = store.query("SELECT id,ts,day,actor,n,payload FROM economy_snapshots ORDER BY id DESC LIMIT ?", (int(n),))
    except Exception:
        snaps = []
    days = []
    for s in snaps:
        pl = json.loads(s["payload"])
        days.append({"id": s["id"], "ts": s["ts"], "day": s["day"], "actor": s["actor"], "strategies": s["n"],
                     "by_stage": {st: sum(1 for v in pl.values() if v["stage"] == st) for st in economy.STAGES},
                     "killed": sum(1 for v in pl.values() if v["killed"])})
    last = days[0] if days else None
    return {"ok": True, "read_only": True, "paper_only": True, "events": events(store, n), "snapshots": days,
            "last_snapshot": last, "due_hour_ct": DUE_HOUR,
            "stale": (last is None) or (time.time() - last["ts"] > 36 * 3600),
            **({"series": series(store, series_days)} if series_days else {})}


class DailyScheduler:
    """Background thread for the `aai hud` server: takes the day's snapshot at/after 07:00 CT. Never on a request."""
    def __init__(self, store, cfg, interval: float = 600.0):
        self.store, self.cfg, self.interval = store, cfg, interval
        self.last_result: dict | None = None
        self.last_error: str | None = None
        self._thread = None
        # health facts for the pipelines row (backlog P3 "Scheduler health in the pipelines panel"); in-memory only
        self.started_at: float | None = None
        self.last_tick_at: float | None = None
        self.last_ok_at: float | None = None
        self.last_error_at: float | None = None
        self.last_taken_at: float | None = None
        self.ticks = 0
        self.errors = 0

    def tick(self, now: float | None = None) -> dict | None:
        t = time.time() if now is None else float(now)
        self.ticks += 1
        self.last_tick_at = t
        try:
            if due(self.store, now):
                self.last_result = take(self.store, self.cfg, actor="scheduler", now=now)
                self.last_error = None
                self.last_ok_at = self.last_taken_at = t
                return self.last_result
            self.last_ok_at = t
            self.last_error = None
        except Exception as e:    # never crash the HUD over a snapshot
            self.last_error = f"{type(e).__name__}: {e}"[:300]
            self.last_error_at = t
            self.errors += 1
        return None

    def health(self) -> dict:
        """In-memory facts for `scheduler_row` (no I/O, never raises)."""
        return {"running": bool(self._thread is not None and self._thread.is_alive()) or self.started_at is None,
                "started_at": self.started_at, "interval": self.interval, "last_tick_at": self.last_tick_at,
                "last_ok_at": self.last_ok_at, "last_error": self.last_error, "last_error_at": self.last_error_at,
                "last_taken_at": self.last_taken_at, "ticks": self.ticks, "errors": self.errors}

    def start(self):
        import threading
        self.started_at = time.time()

        def loop():
            time.sleep(30)
            while True:
                self.tick()
                time.sleep(self.interval)
        self._thread = threading.Thread(target=loop, daemon=True, name="economy-snapshot")
        self._thread.start()
        return self


FIRST_TICK_SEC = 30.0             # loop() sleeps this long before the first tick
SCHED_STALL_SLACK_SEC = 120.0     # a tick later than 2 intervals + this means the thread stalled


def _ago(sec: float) -> str:
    sec = max(0.0, float(sec))
    return f"{int(sec)}s" if sec < 90 else f"{int(sec // 60)}m" if sec < 5400 else f"{sec / 3600:.1f}h" if sec < 172800 else f"{sec / 86400:.0f}d"


def scheduler_row(h: dict | None, last_day: str | None, now: float | None = None) -> dict:
    """Pure: the economy snapshot scheduler as a pipelines row (backlog P3). `h` is `DailyScheduler.health()` or None.

    OFF when this process runs no scheduler (CLI/tests), PENDING before the first tick, ERROR when the last tick
    raised (the error text is cleaned by the caller), STALE when ticks stopped (thread stalled), otherwise OK with
    the last snapshot day and when the next one is due. Read-only: never ticks, never takes a snapshot."""
    now = time.time() if now is None else float(now)
    row = {"id": "econ_scheduler", "name": "Economy snapshot scheduler"}
    today = _dt.datetime.fromtimestamp(now, TZ)
    if last_day == today.strftime("%Y-%m-%d"):
        nxt = "next due tomorrow 07:00 CT"
    elif today.hour < DUE_HOUR:
        nxt = "today's due 07:00 CT"
    else:
        nxt = "today's due now (taken on the next tick)"
    snap = f"last snapshot {last_day}" if last_day else "no snapshot yet"
    if not h:
        return {**row, "state": "OFF", "detail": f"not running in this process (aai hud runs it) · {snap}"}
    interval = float(h.get("interval") or 600.0)
    every = f"every {int(interval // 60)} min" if interval >= 60 else f"every {int(interval)}s"
    facts = {"ticks": int(h.get("ticks") or 0), "errors": int(h.get("errors") or 0), "interval_sec": interval}
    lt, st = h.get("last_tick_at"), h.get("started_at")
    if isinstance(lt, (int, float)):
        row["age_sec"] = round(max(0.0, now - lt), 1)
    if h.get("last_error"):
        ok = h.get("last_ok_at")
        good = f"last good tick {_ago(now - ok)} ago" if isinstance(ok, (int, float)) else "no good tick yet"
        return {**row, **facts, "state": "ERROR", "error": str(h["last_error"])[:240],
                "detail": f"tick failed: {str(h['last_error'])[:160]} · {good} · {snap}"}
    if not isinstance(lt, (int, float)):
        if isinstance(st, (int, float)) and now - st > FIRST_TICK_SEC + SCHED_STALL_SLACK_SEC:
            return {**row, **facts, "state": "STALE", "detail": f"no tick since start {_ago(now - st)} ago (thread stalled?) · {snap}"}
        return {**row, **facts, "state": "PENDING", "detail": f"first tick ~{int(FIRST_TICK_SEC)}s after HUD start · {snap}"}
    if not h.get("running", True) or now - lt > 2 * interval + SCHED_STALL_SLACK_SEC:
        why = "thread stopped" if not h.get("running", True) else "thread stalled?"
        return {**row, **facts, "state": "STALE", "detail": f"no tick for {_ago(now - lt)} ({why}; expected {every}) · {snap}"}
    return {**row, **facts, "state": "OK", "detail": f"ticks {every} · {snap} · {nxt}"}


OVERDUE_ALARM_DAYS = 2            # backlog P3 "Economy snapshot overdue alarm": 2+ due days missed while the HUD was up
OVERDUE_GRACE_SEC = 900.0         # the scheduler's first tick is 30 s after start, then every 600 s: give it 15 min


def missed_while_up(last_day: str | None, started: float, now: float | None = None,
                    grace: float = OVERDUE_GRACE_SEC) -> list[str]:
    """Pure: CT days after `last_day` whose snapshot was due while this HUD process was up long enough to take it.

    Day d counts when the HUD was up for `grace` seconds inside [d 07:00 CT, end of d] (and that window has started):
    days the HUD was down are a gap (the sparkline already shows them), not a stuck scheduler. The scheduler only ever
    takes *today's* snapshot, so a missed day stays missed. With no snapshot at all, counting starts at HUD start."""
    now = time.time() if now is None else float(now)
    start_day = _dt.datetime.fromtimestamp(started, TZ).date()
    try:
        d = _dt.date.fromisoformat(last_day) + _dt.timedelta(days=1) if last_day else start_day
    except (TypeError, ValueError):
        d = start_day
    d = max(d, start_day)
    today = _dt.datetime.fromtimestamp(now, TZ).date()
    out: list[str] = []
    while d <= today and len(out) < SERIES_MAX_DAYS:
        due_ts = _dt.datetime(d.year, d.month, d.day, DUE_HOUR, tzinfo=TZ).timestamp()
        end_ts = _dt.datetime.combine(d + _dt.timedelta(days=1), _dt.time(0), tzinfo=TZ).timestamp()
        if max(due_ts, started) + grace <= min(end_ts, now):
            out.append(d.isoformat())
        d += _dt.timedelta(days=1)
    return out


def overdue_alarm(store, started: float, scheduler_error: str | None = None, now: float | None = None,
                  threshold: int = OVERDUE_ALARM_DAYS) -> dict | None:
    """WARN alarm (chimes once per CT day: the id carries today's date) when the daily snapshot was missed on
    `threshold`+ due days while the HUD was up, i.e. the scheduler thread is stuck or failing. Read-only; never takes
    a snapshot itself (the fix is `aai economy-snapshot` or a HUD restart, both human)."""
    now = time.time() if now is None else float(now)
    last = latest(store)
    last_day = last["day"] if last else None
    missed = missed_while_up(last_day, started, now)
    if len(missed) < threshold:
        return None
    parts = [f"last snapshot {last_day[5:] if last_day else 'never'}",
             f"missed {len(missed)} due days while the HUD was up ({missed[0][5:]}..{missed[-1][5:]})"]
    if scheduler_error:
        parts.append(f"scheduler error: {str(scheduler_error)[:120]}")
    parts.append("run aai economy-snapshot or restart the HUD")
    return {"id": f"econ_snap_overdue_{day_of(now)}", "sev": "warn", "chime": True,
            "title": "ECONOMY SNAPSHOT OVERDUE: daily scheduler stuck", "detail": " · ".join(parts),
            "source": "economy scheduler", "missed_days": missed}
