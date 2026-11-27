"""T11f multiples history: one market cap / P-S / FCF-yield / EV point per watchlist ticker per New York session, taken
from the T11d valuation join (aai/intel/valuation.py) so panel 18 can draw a 90-day P/S sparkline and voice can say which
name sits cheapest against its own range.

Table `multiples_daily` lives in the HUD's SQLite store (tests use tmp DBs). One row per (session, ticker): the session is
the New York date of the quote time, and the row is only replaced by a *later* quote of the same session, so it settles on
the close and earlier sessions are never rewritten (append-only across days). Only priced rows are stored; a withheld
row stores nothing (a gap, never a guess). No backfill: history starts on the first session the HUD priced.
Research only, not a signal; nothing here creates an idea, ticket or order."""
from __future__ import annotations
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

NY = ZoneInfo("America/New_York")
SCHEMA = """
CREATE TABLE IF NOT EXISTS multiples_daily (
  session TEXT NOT NULL, ticker TEXT NOT NULL, quote_ts REAL NOT NULL, recorded_at REAL NOT NULL,
  price REAL, mcap REAL, ev REAL, ps REAL, fcf_yield REAL, split_adjusted INTEGER NOT NULL DEFAULT 0, period_end TEXT,
  PRIMARY KEY (session, ticker));
"""
DAYS = 90
MIN_RANGE_SESSIONS = 5   # fewer sessions than this is not a "range": voice stays quiet, the HUD says how many are logged


def _n(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and abs(v) != float("inf") else None


def ensure(store) -> None:
    if not getattr(store, "_multiples_daily_ok", False):
        with store._lock:
            store.conn.executescript(SCHEMA)
        store._multiples_daily_ok = True


def session_of(ts: float) -> str:
    return datetime.fromtimestamp(ts, NY).date().isoformat()


def record(store, valuation: dict | None, fundamentals: dict | None = None, now: float | None = None) -> int:
    """Upsert today's point for every priced row. Returns how many rows were written or moved to a later quote."""
    ensure(store)
    rows = ((valuation or {}).get("rows") or {}) if isinstance(valuation, dict) else {}
    pe = {str(r.get("ticker")).upper(): r.get("period_end") for r in ((fundamentals or {}).get("rows") or [])
          if isinstance(r, dict) and r.get("ticker")}
    now = now or time.time()
    n = 0
    for t, m in rows.items():
        if not isinstance(m, dict) or _n(m.get("mcap")) is None or _n(m.get("price_ts")) is None:
            continue
        qts = _n(m["price_ts"])
        if qts > now + 3600:          # a quote from the future is bad data, not a point
            continue
        tk = str(t).upper()[:10]
        cur = store.execute(
            """INSERT INTO multiples_daily(session,ticker,quote_ts,recorded_at,price,mcap,ev,ps,fcf_yield,split_adjusted,period_end)
               VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(session,ticker) DO UPDATE SET
               quote_ts=excluded.quote_ts, recorded_at=excluded.recorded_at, price=excluded.price, mcap=excluded.mcap,
               ev=excluded.ev, ps=excluded.ps, fcf_yield=excluded.fcf_yield, split_adjusted=excluded.split_adjusted,
               period_end=excluded.period_end
               WHERE excluded.quote_ts > multiples_daily.quote_ts""",
            (session_of(qts), tk, qts, now, _n(m.get("price")), _n(m.get("mcap")), _n(m.get("ev")), _n(m.get("ps")),
             _n(m.get("fcf_yield")), 1 if m.get("split_adj") else 0, str(pe.get(tk) or "")[:10] or None))
        n += cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0
    return n


def series(store, now: float | None = None, days: int = DAYS) -> dict:
    """{'days': N, 'tickers': {T: {'points': [[session, ps, mcap, fcf_yield], ...], 'n', 'ps_lo', 'ps_hi', 'ps_pos',
    'first', 'last', 'period_changed', 'period_marks'}}, 'sessions': distinct sessions logged}.
    `period_marks` (T11h) = [{'session', 'period_end', 'prev_period_end'}] for each session whose point is the first one priced
    off a newer filing (a new revenue TTM), so the sparkline can mark where a P/S step comes from the denominator. `ps_pos` = where the latest P/S sits in its
    own window (0 = cheapest, 1 = richest), only with MIN_RANGE_SESSIONS+ P/S points and a non-flat range."""
    ensure(store)
    days = max(1, min(int(days or DAYS), 365))
    now = now or time.time()
    since = (datetime.fromtimestamp(now, NY).date() - timedelta(days=days)).isoformat()
    rows = store.query("SELECT session,ticker,ps,mcap,fcf_yield,period_end FROM multiples_daily WHERE session>=? ORDER BY ticker, session",
                     (since,)) or []
    out: dict = {"days": days, "tickers": {}, "sessions": 0, "min_range_sessions": MIN_RANGE_SESSIONS}
    sess = set()
    for r in rows:
        sess.add(r["session"])
        d = out["tickers"].setdefault(r["ticker"], {"points": [], "periods": [], "period_marks": [], "_pe": None})
        d["points"].append([r["session"], r["ps"], r["mcap"], r["fcf_yield"]])
        pe = r["period_end"]
        if pe and pe not in d["periods"]:
            d["periods"].append(pe)
        if pe and d["_pe"] and pe != d["_pe"]:   # T11h: first session priced off a new filing's revenue TTM
            d["period_marks"].append({"session": r["session"], "period_end": pe, "prev_period_end": d["_pe"]})
        if pe:
            d["_pe"] = pe
    out["sessions"] = len(sess)
    for t, d in out["tickers"].items():
        ps = [p[1] for p in d["points"] if _n(p[1]) is not None]
        d.update(n=len(d["points"]), first=d["points"][0][0], last=d["points"][-1][0], ps_lo=min(ps) if ps else None,
                 ps_hi=max(ps) if ps else None, ps_pos=None, period_changed=len(d.pop("periods")) > 1)
        d.pop("_pe", None)
        if len(ps) >= MIN_RANGE_SESSIONS and max(ps) > min(ps):
            d["ps_pos"] = (ps[-1] - min(ps)) / (max(ps) - min(ps))
    return out


def text(h: dict | None) -> str:
    """Spoken: the name cheapest against its own range. Silent until a range exists. Never a buy/sell call."""
    if not h or not h.get("tickers"):
        return ""
    ranked = sorted(((t, d) for t, d in h["tickers"].items() if d.get("ps_pos") is not None), key=lambda x: (x[1]["ps_pos"], x[0]))
    if not ranked:
        return (f"Multiples history: {h.get('sessions', 0)} session{'s' if h.get('sessions') != 1 else ''} logged; "
                f"a range needs {MIN_RANGE_SESSIONS}.")
    t, d = ranked[0]
    lo_t, hi_t = ranked[0], ranked[-1]
    s = (f"Cheapest versus its own {d['n']}-session range: {t} at {d['points'][-1][1]:.1f} times sales "
         f"(range {d['ps_lo']:.1f} to {d['ps_hi']:.1f}).")
    if len(ranked) > 1 and hi_t[1]["ps_pos"] > lo_t[1]["ps_pos"]:
        s += f" Richest versus its range: {hi_t[0]} at {hi_t[1]['points'][-1][1]:.1f} times."
    if d.get("period_changed"):
        pm = (d.get("period_marks") or [])[-1:]
        s += (f" {t}'s sales figure changed with a new filing inside that window"
              + (f", from the {pm[0]['session']} session." if pm else "."))
    return s
