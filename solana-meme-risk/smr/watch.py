"""python -m risk watch - poll new pump.fun launches and score them within rate limits.

Each poll: pump.fun latest coins (fallback: the on-chain create stream). A launch is queued when it is
>= score_delay_s + 120 s old (so its as-of = create + score_delay_s is finalized) and <= --max-age-s old, then
pre-filtered with ONE RPC call (>= --min-txs successful txs in its first score_delay_s - the same eligibility
rule as the backtest) and scored AS OF create + score_delay_s, i.e. exactly the point-in-time setup the
thresholds were fitted on. Results: SQLite table `scored_tokens` (data/watch/scored_tokens.db) and a rolling
JSONL feed data/watch/feed-YYYYMMDD.jsonl (orchestrator_summary + key fields; files older than --keep-days
are deleted). Read-only: never trades, signs or touches keys."""
from __future__ import annotations
import glob, json, os, signal, sqlite3, threading, time
from concurrent.futures import ThreadPoolExecutor, Future
from . import config as C, logging_setup as L

log = L.get("watch")

DDL = """CREATE TABLE IF NOT EXISTS scored_tokens (
  mint TEXT PRIMARY KEY, symbol TEXT, created_at INTEGER, as_of INTEGER, scored_at REAL, elapsed_s REAL,
  score INTEGER, recommendation TEXT, max_size_pct REAL, confidence TEXT, hard_flags TEXT, top_reasons TEXT,
  model_version TEXT, report_json TEXT, summary_json TEXT, error TEXT);
CREATE INDEX IF NOT EXISTS scored_tokens_at ON scored_tokens(scored_at);
CREATE TABLE IF NOT EXISTS skipped_launches (mint TEXT PRIMARY KEY, created_at INTEGER, reason TEXT, checked_at REAL);"""


class WatchStore:
    def __init__(self, d):
        os.makedirs(d, exist_ok=True)
        self.dir = d
        self.db = sqlite3.connect(os.path.join(d, "scored_tokens.db"), timeout=60, check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL"); self.db.executescript(DDL)
        self.lock = threading.Lock()

    def seen(self, mint):
        with self.lock:
            return bool(self.db.execute("SELECT 1 FROM scored_tokens WHERE mint=? UNION SELECT 1 FROM skipped_launches WHERE mint=?", (mint, mint)).fetchone())

    def skip(self, mint, created, reason):
        with self.lock:
            self.db.execute("INSERT OR REPLACE INTO skipped_launches VALUES (?,?,?,?)", (mint, created, reason, time.time())); self.db.commit()

    def save(self, mint, created, as_of, doc, err, elapsed):
        s = (doc or {}).get("orchestrator_summary") or {}
        row = (mint, (doc or {}).get("asset", {}).get("symbol"), created, as_of, time.time(), round(elapsed, 2),
               (doc or {}).get("score"), (doc or {}).get("recommendation"), s.get("max_size_pct"), s.get("confidence"),
               json.dumps(s.get("hard_flags")), json.dumps(s.get("top_reasons")), s.get("model"),
               json.dumps(doc) if doc else None, json.dumps(s) if s else None, err)
        with self.lock:
            self.db.execute(f"INSERT OR REPLACE INTO scored_tokens VALUES ({','.join('?' * 16)})", row); self.db.commit()
        if doc:
            feed = os.path.join(self.dir, time.strftime("feed-%Y%m%d.jsonl", time.gmtime()))
            line = {"type": "risk_report_summary", "summary": s, "report_id": doc["report_id"], "elapsed_s": round(elapsed, 2),
                    "scored_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
            with self.lock, open(feed, "a") as f:
                f.write(json.dumps(line) + "\n")

    def rotate(self, keep_days):
        for p in glob.glob(os.path.join(self.dir, "feed-*.jsonl")):
            if time.time() - os.path.getmtime(p) > keep_days * 86400:
                os.remove(p)


def _pct(xs, q):
    xs = sorted(xs)
    return round(xs[min(len(xs) - 1, int(q * len(xs)))], 2) if xs else None


def run(ctx, minutes=10.0, poll_s=20, parallel=2, min_txs=15, max_age_s=900, max_tokens=None, keep_days=7, progress=print):
    from .pipeline import score_mint
    s = ctx.settings
    store = WatchStore(os.path.join(s.data_dir, "watch"))
    store.rotate(keep_days)
    stop = threading.Event()
    for sg in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sg, lambda *_: stop.set())
        except ValueError:
            pass
    st = {"started_at": time.time(), "polls": 0, "poll_errors": 0, "launches_seen": 0, "too_quiet": 0, "queued": 0, "scored": 0,
          "errors": 0, "decisions": {"SKIP": 0, "REDUCED": 0, "NORMAL": 0}, "elapsed_s": [], "lag_s": []}
    ex = ThreadPoolExecutor(parallel)
    inflight: dict[str, Future] = {}
    seen_now = set()
    deadline = time.time() + minutes * 60

    def job(mint, created, as_of):
        t = time.time()
        try:
            doc = score_mint(mint, ctx=ctx, as_of=as_of)
            store.save(mint, created, as_of, doc, None, time.time() - t)
            st["scored"] += 1; st["decisions"][doc["recommendation"]] += 1
            st["elapsed_s"].append(time.time() - t); st["lag_s"].append(time.time() - created)
            progress(f"{doc['orchestrator_summary']['line']}  ({time.time() - t:.0f}s)")
        except Exception as e:
            st["errors"] += 1
            store.save(mint, created, as_of, None, f"{type(e).__name__}: {e}"[:500], time.time() - t)
            progress(f"error {mint[:8]}: {e}")

    while not stop.is_set() and time.time() < deadline:
        t_poll = time.time()
        st["polls"] += 1
        # pump.fun lists ~0.6 launches/s, so the [delay+120 s, max_age_s] window sits several pages deep
        coins = []
        try:
            for off in range(0, 50 * 25, 50):
                page = ctx.pumpfun.latest_coins(limit=50, offset=off, ttl=5) or []
                coins.extend(page)
                if not page or time.time() - (page[-1].get("created_timestamp") or 0) / 1000 > max_age_s:
                    break
        except Exception as e:
            st["poll_errors"] += 1
            progress(f"poll error: {e}")
        now = time.time()
        for c in coins:
            mint, created = c.get("mint"), (c.get("created_timestamp") or 0) / 1000
            if not mint or mint in seen_now:
                continue
            age = now - created
            if age < s.score_delay_s + 120 or age > max_age_s:
                continue
            seen_now.add(mint)
            st["launches_seen"] += 1
            if store.seen(mint) or mint in inflight:
                continue
            as_of = int(created) + s.score_delay_s
            try:
                a = ctx.anchors.anchor_at(as_of, max_pages=0) or (ctx.anchors.ensure_range(as_of - 600, int(now)) and ctx.anchors.anchor_at(as_of, max_pages=0))
                page = ctx.rpc.get_signatures(mint, 1000, before=a["signature"]) if a else []
                n = sum(1 for x in page if x.get("err") is None and created - 5 <= (x.get("blockTime") or 0) <= as_of)
            except Exception as e:
                n = -1; progress(f"prefilter error {mint[:8]}: {e}")
            if n < min_txs:
                st["too_quiet"] += 1; store.skip(mint, int(created), f"txs_first_{s.score_delay_s}s={n}")
                continue
            if max_tokens and st["queued"] >= max_tokens:
                continue
            st["queued"] += 1
            inflight[mint] = ex.submit(job, mint, int(created), as_of)
        inflight = {m: f for m, f in inflight.items() if not f.done()}
        # backpressure: don't let the queue grow beyond what the rate budget can finish
        while len(inflight) > 2 * parallel and not stop.is_set() and time.time() < deadline:
            time.sleep(1); inflight = {m: f for m, f in inflight.items() if not f.done()}
        stop.wait(max(0, poll_s - (time.time() - t_poll)))
    progress("stopping: waiting for in-flight scores (no new work)")
    for f in list(inflight.values()):
        f.cancel()
    ex.shutdown(wait=True, cancel_futures=True)
    el = st.pop("elapsed_s"); lag = st.pop("lag_s")
    st.update({"finished_at": time.time(), "wall_minutes": round((time.time() - st["started_at"]) / 60, 2),
               "score_time_s": {"p50": _pct(el, 0.5), "p95": _pct(el, 0.95), "max": round(max(el), 1) if el else None},
               "launch_to_decision_s": {"p50": _pct(lag, 0.5), "p95": _pct(lag, 0.95)},
               "sources": ctx.source_snapshot(), "db": os.path.join(store.dir, "scored_tokens.db")})
    json.dump(st, open(os.path.join(store.dir, "last_run_stats.json"), "w"), indent=2)
    return st


def _main(a):
    from .context import default_context
    ctx = default_context()
    st = run(ctx, minutes=a.minutes, poll_s=a.poll, parallel=a.parallel, min_txs=a.min_txs, max_age_s=a.max_age_s, max_tokens=a.max_tokens,
             keep_days=a.keep_days, progress=lambda m: print(f"[watch] {m}", flush=True))
    print(json.dumps({k: v for k, v in st.items() if k != "sources"}, indent=2))


def add_parser(sub):
    p = sub.add_parser("watch", help="poll new launches, score them, store in scored_tokens + JSONL feed")
    p.add_argument("--minutes", type=float, default=10.0, help="run time (0 < m); use a process supervisor for 24/7")
    p.add_argument("--poll", type=float, default=20.0)
    p.add_argument("--parallel", type=int, default=2)
    p.add_argument("--min-txs", type=int, default=15)
    p.add_argument("--max-age-s", type=int, default=900)
    p.add_argument("--max-tokens", type=int, default=None)
    p.add_argument("--keep-days", type=float, default=7)
    p.set_defaults(fn=_main)
