"""1-minute exit watcher for the momentum family (SIMULATION ONLY: no wallets, keys, signing or orders).

Every ~60 s: ONE DexScreener /tokens/v1 batch call (<= 30 mints; a second call only if > 30 mints are open) for the open
positions of momentum + all its control books + the scanner book (smr/paper/scanner.py), plus (when the batch has room, ~every 15 min) the dust bags of closed
signal-book positions. Optional GeckoTerminal 1-min OHLCV for open momentum_sighv positions within a per-minute budget
(default 10/min, paused while a 15-min paper cycle is running because the cycle uses the same ~30/min free tier).
No pump.fun calls at all.

Writes (one short BEGIN IMMEDIATE transaction per tick, rows re-read inside it): the exit-watcher lease, one `marks` row
per quoted mint (price, liquidity, DexScreener m5/h1 buys/sells/volume), and the exits of the two signal books
(smr/paper/sigbooks.py). It does NOT write momentum / momentum_ladder / momentum_x1 rows or any event: the live clip5
book keeps its 15-min cadence and its alerts. For the live book it only logs what clip5 WOULD have done at this mark
(`live_clip5_would_fire`), so the cost of the 15-min cadence can be measured.

Files (next to the ledger, data/ by default): watcher.pid, watcher.lock (single instance), watcher.heartbeat.json,
watcher.log (JSON lines, rotated 2 MB x 5), watcher.out (nohup stdout/stderr)."""
from __future__ import annotations
import fcntl, json, logging, logging.handlers, os, signal, subprocess, sys, threading, time
from collections import deque
from . import exits as X
from . import sigbooks as SB
from .engine import MOMENTUM_BOOK, MOMENTUM_FAMILY, SIGNAL_BOOKS, CONTROL_BOOKS, SCANNER_BOOK, EXPERIMENT100_BOOK, STEP_BOOKS, iso_ct

DEX_BATCH = 30
DEFAULT_INTERVAL_S = 60
DEFAULT_GT_PER_MIN = 4       # observed: GeckoTerminal's keyless API 429s well below its nominal 30/min
GT_MAX_PER_MIN = 25
DUST_REMARK_S = 900
STALE_FACTOR = 5           # heartbeat older than STALE_FACTOR x interval -> `start` restarts the process
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WATCH_BOOKS = tuple(dict.fromkeys((*MOMENTUM_FAMILY, *CONTROL_BOOKS, SCANNER_BOOK, EXPERIMENT100_BOOK)))


def paths(db):
    d = os.path.dirname(os.path.abspath(db))
    return {k: os.path.join(d, f"watcher.{k}") for k in ("pid", "lock", "log", "out")} | {"heartbeat": os.path.join(d, "watcher.heartbeat.json")}


def gt_share_path(db):
    return os.path.join(os.path.dirname(os.path.abspath(db)), "gt_share.json")


class _Shim:
    """Just enough of a Context for prices.dexscreener_quotes (no disk cache: ttl=0 calls are never cached)."""
    def __init__(self, dex_h):
        self.dex = type("D", (), {"h": dex_h})()


GT_PAUSE_S = 300            # after a GeckoTerminal 429: no candle calls for 5 min
GT_TICK_BUDGET_S = 20       # never spend more than this per tick on GeckoTerminal (its bucket paces calls at 0.4/s)


def live_sources():
    from .. import config as C
    from ..cache import DiskCache
    from ..sources.http import HttpSource
    s = C.load_settings()
    off = DiskCache(":memory:", mode="off")
    dex = HttpSource("dexscreener", s.dexscreener_api, 1.0, off, {"User-Agent": s.http_ua}, max_attempts=1, timeout=20)
    gt = HttpSource("geckoterminal", s.geckoterminal_api, 0.4, off, {"User-Agent": s.http_ua, "Accept": "application/json"}, max_attempts=1, timeout=20)
    from .prices import dexscreener_quotes

    def cooldown(src):
        return lambda: max(0.0, src.bucket.penalty_until - time.monotonic())   # > 0 after a 429 (Retry-After)

    def dex_fn(mints):
        return dexscreener_quotes(_Shim(dex), mints)
    dex_fn.cooldown = cooldown(dex)

    def gt_fn(pool):
        j = gt.get_json(f"/networks/solana/pools/{pool}/ohlcv/minute?aggregate=1&limit=30&currency=usd", ttl=0) or {}
        return ((j.get("data") or {}).get("attributes") or {}).get("ohlcv_list") or []
    gt_fn.cooldown = cooldown(gt)
    return dex_fn, gt_fn, {"dexscreener": dex, "geckoterminal": gt}


class Watcher:
    def __init__(self, led, dex_fn, gt_fn=None, *, clock=time.time, interval_s=DEFAULT_INTERVAL_S, gt_per_min=DEFAULT_GT_PER_MIN,
                 heartbeat_path=None, logger=None, pid=None, sources=None, gt_share=None):
        self.led, self.dex_fn, self.gt_fn, self.clock = led, dex_fn, gt_fn, clock
        self.interval_s = interval_s
        self.gt_per_min = max(0, min(GT_MAX_PER_MIN, gt_per_min))
        self.hb_path, self.log = heartbeat_path, logger or logging.getLogger("smr.paper.watcher")
        self.pid = pid or os.getpid()
        self.sources = sources or {}
        self.gt_share = gt_share      # GtShare: GeckoTerminal window shared with the scanner daemon (None = own budget only)
        self.candles = {}           # mint -> {"at", "pool", "bars"}
        self.gt_credit = 0.0
        self.calls = {"dexscreener": deque(), "geckoterminal": deque()}
        self.ticks = 0
        self.errors = 0
        self.started = clock()
        self.last = {}
        self._pruned_at = 0.0
        self._rr = 0
        self.gt_pause_until = 0.0
        self.gt_429 = 0

    # ---- helpers ------------------------------------------------------------------------------------------------
    def _count(self, src, n, now):
        q = self.calls[src]
        q.extend([now] * n)
        while q and q[0] < now - 3600:
            q.popleft()

    def _cycle_running(self, now):
        r = self.led.one("SELECT started_at, finished_at FROM cycles ORDER BY id DESC LIMIT 1")
        return bool(r and r["finished_at"] is None and now - (r["started_at"] or 0) < 900)

    def _bars(self, raw, now):
        out = []
        for x in raw or []:
            try:
                t, o, h, l, c, v = (float(y) for y in x[:6])
            except (TypeError, ValueError):
                continue
            if t + 60 <= now and c > 0:          # closed bars only
                out.append([t, o, h, l, c, v])
        return sorted(out)

    # ---- one tick ---------------------------------------------------------------------------------------------
    def tick(self):
        now = self.clock()
        t_start = time.monotonic()
        led = self.led
        rows = led.q(f"SELECT id, book, mint, entry_at, exit_policy FROM positions WHERE status='open' AND void_reason IS NULL "
                     f"AND book IN ({','.join('?' * len(WATCH_BOOKS))}) ORDER BY entry_at", WATCH_BOOKS)
        open_mints = list(dict.fromkeys(r["mint"] for r in rows))
        # > 30 open mints: two calls per tick at most; beyond 60 the rest rotate (round robin)
        if len(open_mints) > 2 * DEX_BATCH:
            k = self._rr % len(open_mints); open_mints = (open_mints[k:] + open_mints[:k])[:2 * DEX_BATCH]; self._rr += 2 * DEX_BATCH
        ncalls = -(-len(open_mints) // DEX_BATCH)
        room = ncalls * DEX_BATCH - len(open_mints)
        dust = led.q(f"SELECT * FROM positions WHERE status='closed' AND void_reason IS NULL AND COALESCE(dust_tokens,0)>0 "
                     f"AND book IN ({','.join('?' * len(STEP_BOOKS))}) AND COALESCE(dust_last_at,0) < ? ORDER BY COALESCE(dust_last_at,0) LIMIT ?",
                     (*STEP_BOOKS, now - DUST_REMARK_S, room if ncalls else DEX_BATCH))
        dust = [d for d in dust if d["mint"] not in open_mints]
        mints = open_mints + list(dict.fromkeys(d["mint"] for d in dust))
        qs, errs = ({}, [])
        cd = getattr(self.dex_fn, "cooldown", None)
        if mints and cd and cd() > 0:                   # DexScreener said 429: skip this mark, never block the tick on it
            errs.append(f"dexscreener cooldown {cd():.0f}s (429), mark skipped"); mints = []
        if mints:
            try:
                qs, errs = self.dex_fn(mints)
            except Exception as e:                      # network: the tick still renews the lease and logs
                qs, errs = {}, [f"{type(e).__name__}: {e}"[:200]]
            self._count("dexscreener", -(-len(mints) // DEX_BATCH), now)
        # GeckoTerminal 1-min candles for open SIG-HV positions (budgeted, paused during a paper cycle)
        cyc = self._cycle_running(now)
        gt_used = 0
        if self.gt_fn and self.gt_per_min and not cyc and now >= self.gt_pause_until:
            self.gt_credit = min(self.gt_per_min, self.gt_credit + self.gt_per_min * self.interval_s / 60.0)
            want = sorted({r["mint"] for r in rows if r["book"] == "momentum_sighv" and qs.get(r["mint"]) is not None and qs[r["mint"]].pair},
                          key=lambda m: (self.candles.get(m) or {}).get("at", 0))
            gcd = getattr(self.gt_fn, "cooldown", None)
            for m in want:
                if self.gt_credit < 1 or time.monotonic() - t_start > GT_TICK_BUDGET_S:
                    break
                if gcd and gcd() > 0:                   # 429 from GeckoTerminal: back off (marks-only features meanwhile)
                    errs.append(f"geckoterminal cooldown {gcd():.0f}s (429)"); self.gt_credit = 0.0
                    break
                if self.gt_share is not None and not self.gt_share.try_acquire("watcher"):
                    errs.append("geckoterminal shared budget full or paused (scanner/429)")
                    break
                self.gt_credit -= 1; gt_used += 1
                try:
                    self.candles[m] = {"at": now, "pool": qs[m].pair, "bars": self._bars(self.gt_fn(qs[m].pair), now)}
                except Exception as e:
                    errs.append(f"gt ohlcv {m[:8]}: {type(e).__name__} {str(e)[-40:]}"[:160])
                    if "429" in str(e) or "circuit open" in str(e):
                        self.gt_pause_until = now + GT_PAUSE_S; self.gt_credit = 0.0; self.gt_429 += 1
                        if self.gt_share is not None:
                            self.gt_share.penalize("watcher", GT_PAUSE_S)
                        break
            if gt_used:
                self._count("geckoterminal", gt_used, now)
        stats = {"closed": {}, "momentum": {"control_closed": 0}, "marked": 0, "unpriced_marks": 0}
        fills, would = [], []
        with led.tx():
            SB.renew_lease(led, self.pid, now, max(SB.LEASE_TTL_S, 3 * self.interval_s))
            for m, q in qs.items():
                SB.record_mark(led, q, now, "watcher")
            for r in rows:
                if r["book"] not in STEP_BOOKS:
                    continue
                p = led.one("SELECT * FROM positions WHERE id=? AND status='open' AND void_reason IS NULL", (r["id"],))
                if p is None:
                    continue
                c = self.candles.get(p["mint"])
                bars = c["bars"] if c and now - c["at"] <= 180 else []
                SB.step(led, p, qs.get(p["mint"]), now, "watcher", stats, candles=bars, fills=fills)
            for d in dust:
                SB.mark_dust(led, d, qs.get(d["mint"]), now)
            if now - self._pruned_at > 3600:
                SB.prune_marks(led, now); self._pruned_at = now
        # live clip5 book: read-only "what a 1-min mark would have done" (never applied, never an event)
        for r in rows:
            if r["book"] != MOMENTUM_BOOK or not r["exit_policy"] or qs.get(r["mint"]) is None:
                continue
            p = led.one("SELECT * FROM positions WHERE id=?", (r["id"],))
            pol = X.get(p["exit_policy"]) if p else None
            if pol is None or p["status"] != "open":
                continue
            px = qs[r["mint"]].price_usd
            acts = X.evaluate(pol, {**p, "peak_price": max(p["peak_price"] or p["entry_price"], px)}, px, now)
            if acts:
                would.append({"mint": p["mint"], "price": px, "actions": [list(a) for a in acts]})
        self.ticks += 1
        m5 = {m: {"px": q.price_usd, "b5": (q.mom_raw or {}).get("buys_m5"), "s5": (q.mom_raw or {}).get("sells_m5"),
                  "v5": (q.mom_raw or {}).get("vol_m5")} for m, q in qs.items()}
        self.last = {"at": now, "at_ct": iso_ct(now), "open_positions": len(rows), "open_mints": len(open_mints), "dust_marked": len(dust),
                     "quoted": len(qs), "unquoted": len(mints) - len(qs), "dex_calls": -(-len(mints) // DEX_BATCH) if mints else 0,
                     "gt_calls": gt_used, "cycle_running": cyc, "fills": len(fills), "errors": errs[:5]}
        self.log.info(json.dumps({"kind": "tick", **self.last, "marks": m5}, default=str))
        for f in fills:
            self.log.info(json.dumps({"kind": "fill", **f}, default=str))
        for w in would:
            self.log.info(json.dumps({"kind": "live_clip5_would_fire", **w}, default=str))
        self.last["tick_s"] = round(time.monotonic() - t_start, 1)
        self.heartbeat(self.clock())
        return {**self.last, "fills": fills, "would": would}

    def heartbeat(self, now, error=None):
        if not self.hb_path:
            return
        hb = {"pid": self.pid, "at": now, "at_ct": iso_ct(now), "interval_s": self.interval_s, "ticks": self.ticks, "errors": self.errors,
              "started_at_ct": iso_ct(self.started), "last_tick": self.last, "last_error": error,
              "calls_last_hour": {k: len(v) for k, v in self.calls.items()},
              "calls_last_minute": {k: sum(1 for t in v if t >= now - 60) for k, v in self.calls.items()},
              "gt_per_min_budget": self.gt_per_min, "gt_429": self.gt_429,
              "gt_paused_until_ct": iso_ct(self.gt_pause_until) if self.gt_pause_until > now else None,
              "http": {k: getattr(s, "stats", {}) for k, s in self.sources.items()}}
        if self.gt_share is not None:
            try:
                hb["gt_shared"] = self.gt_share.state()
            except OSError:
                pass
        tmp = self.hb_path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(hb, f, default=str)
        os.replace(tmp, self.hb_path)

    def run(self, stop: threading.Event):
        while not stop.is_set():
            t = self.clock()
            try:
                self.tick()
            except Exception as e:
                self.errors += 1
                self.log.exception(json.dumps({"kind": "tick_error", "error": f"{type(e).__name__}: {e}"[:300]}))
                try:
                    self.heartbeat(self.clock(), error=f"{type(e).__name__}: {e}"[:300])
                except OSError:
                    pass
            stop.wait(max(1.0, self.interval_s - (self.clock() - t)))


# ---- process management -----------------------------------------------------------------------------------------
def _alive(pid):
    try:
        os.kill(pid, 0)
    except (OSError, TypeError):
        return False
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            cmd = f.read().replace(b"\0", b" ")
        return b"watcher" in cmd and b"run" in cmd
    except OSError:
        return True


def _read_pid(P):
    try:
        with open(P["pid"]) as f:
            return int(f.read().strip())
    except (OSError, ValueError):
        return None


def status(db):
    P = paths(db)
    pid = _read_pid(P)
    alive = bool(pid and _alive(pid))
    hb = None
    try:
        with open(P["heartbeat"]) as f:
            hb = json.load(f)
    except (OSError, ValueError):
        pass
    now = time.time()
    age = round(now - hb["at"], 1) if hb else None
    iv = (hb or {}).get("interval_s") or DEFAULT_INTERVAL_S
    return {"running": alive, "pid": pid if alive else None, "heartbeat_age_s": age, "healthy": bool(alive and age is not None and age <= 3 * iv),
            "stale": bool(alive and (age is None or age > STALE_FACTOR * iv)), "heartbeat_at_ct": (hb or {}).get("at_ct"),
            "ticks": (hb or {}).get("ticks"), "errors": (hb or {}).get("errors"), "last_error": (hb or {}).get("last_error"),
            "last_tick": (hb or {}).get("last_tick"), "calls_last_hour": (hb or {}).get("calls_last_hour"),
            "calls_last_minute": (hb or {}).get("calls_last_minute"), "log": P["log"], "heartbeat_file": P["heartbeat"]}


def stop(db, timeout_s=15):
    P = paths(db)
    pid = _read_pid(P)
    if not pid or not _alive(pid):
        return {"action": "not_running"}
    os.kill(pid, signal.SIGTERM)
    t0 = time.time()
    while time.time() - t0 < timeout_s and _alive(pid):
        time.sleep(0.3)
    if _alive(pid):
        os.kill(pid, signal.SIGKILL); time.sleep(0.5)
        return {"action": "killed", "pid": pid}
    return {"action": "stopped", "pid": pid}


def _maintenance_block(db):
    """If <db-dir>/MAINTENANCE.json is active, refuse start/restart (supervision coordination)."""
    import json, time as _t
    path = os.path.join(os.path.dirname(os.path.abspath(db)), "MAINTENANCE.json")
    try:
        with open(path) as f:
            m = json.load(f)
    except (OSError, ValueError):
        return None
    if not m.get("active"):
        return None
    until = m.get("until")
    if until is not None and _t.time() > float(until):
        return None
    return {"action": "blocked_maintenance", "maintenance": m, "db": os.path.abspath(db)}


def start(db, interval_s=DEFAULT_INTERVAL_S, gt_per_min=DEFAULT_GT_PER_MIN, wait_s=20):
    """Idempotent: running + fresh heartbeat -> nothing; running but stale (hung) -> restart; dead -> start (nohup)."""
    blocked = _maintenance_block(db)
    if blocked:
        return {**blocked, **{k: status(db).get(k) for k in ("running", "healthy", "pid", "stale", "heartbeat_age_s")}}
    st = status(db)
    action = "started"
    if st["running"] and not st["stale"]:
        return {"action": "already_running", **st}
    if st["running"] and st["stale"]:
        stop(db); action = "restarted_stale"
    P = paths(db)
    cmd = [sys.executable, "-m", "risk", "paper", "watcher", "run", "--db", os.path.abspath(db), "--interval", str(interval_s),
           "--gt-per-min", str(gt_per_min)]
    if os.path.exists("/usr/bin/nohup") or os.path.exists("/bin/nohup"):
        cmd = ["nohup", *cmd]
    out = open(P["out"], "ab")
    subprocess.Popen(cmd, cwd=ROOT, stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT, start_new_session=True, close_fds=True)
    out.close()
    t0 = time.time()
    while time.time() - t0 < wait_s:
        st = status(db)
        if st["running"] and st["heartbeat_age_s"] is not None and st["heartbeat_age_s"] < 5:
            break
        time.sleep(0.5)
    return {"action": action, **status(db)}


def run_forever(db, interval_s=DEFAULT_INTERVAL_S, gt_per_min=DEFAULT_GT_PER_MIN):
    from .ledger import Ledger
    P = paths(db)
    lockf = open(P["lock"], "w")
    try:
        fcntl.flock(lockf, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print(json.dumps({"skipped": "another exit watcher holds the lock"})); return 0
    log = logging.getLogger("smr.paper.watcher.file")
    log.setLevel(logging.INFO); log.propagate = False
    h = logging.handlers.RotatingFileHandler(P["log"], maxBytes=2_000_000, backupCount=5)
    h.setFormatter(logging.Formatter("%(message)s"))
    log.addHandler(h)
    with open(P["pid"], "w") as f:
        f.write(str(os.getpid()))
    stop_ev = threading.Event()
    signal.signal(signal.SIGTERM, lambda *a: stop_ev.set())
    signal.signal(signal.SIGINT, lambda *a: stop_ev.set())
    signal.signal(signal.SIGHUP, signal.SIG_IGN)
    led = Ledger(db)
    dex_fn, gt_fn, src = live_sources()
    from .gtshare import GtShare
    w = Watcher(led, dex_fn, gt_fn if gt_per_min > 0 else None, interval_s=interval_s, gt_per_min=gt_per_min, heartbeat_path=P["heartbeat"],
                logger=log, sources=src, gt_share=GtShare(gt_share_path(db)))
    log.info(json.dumps({"kind": "start", "pid": os.getpid(), "at_ct": iso_ct(time.time()), "interval_s": interval_s, "gt_per_min": gt_per_min, "db": db}))
    try:
        w.run(stop_ev)
    finally:
        try:
            with led.tx():
                SB.release_lease(led, w.pid)
        except Exception:
            pass
        log.info(json.dumps({"kind": "stop", "pid": os.getpid(), "at_ct": iso_ct(time.time()), "ticks": w.ticks, "errors": w.errors}))
        try:
            if _read_pid(P) == os.getpid():
                os.remove(P["pid"])
        except OSError:
            pass
        led.close()
    return 0
