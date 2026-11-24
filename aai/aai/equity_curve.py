"""Paper equity curve for the Zoora positions panel (backlog P3 "Equity sparkline").

The ledger only writes `equity_snapshots` when a position closes, so a quiet book has almost no curve. The `aai hud`
server runs `HourlyMarker`, which appends one mark per hour from the ledger's own `equity()` (marks only, no orders,
no state change). `curve()` is read-only and downsamples for the HUD. Tests use tmp stores only.
"""
from __future__ import annotations

import threading
import time

MARK_INTERVAL = 3600.0     # one mark per hour at most
MAX_POINTS = 120           # downsample cap for the HUD
ALLOWED_DAYS = (1.0, 7.0, 30.0)  # panel-02 range chips (1D / 7D / 30D)


def clamp_days(raw) -> float:
    """Map a query/UI value onto an allowed window; default 7D. Never invent other ranges."""
    try:
        d = float(raw)
    except (TypeError, ValueError):
        return 7.0
    return min(ALLOWED_DAYS, key=lambda a: abs(a - d))


def last_mark_ts(store) -> float | None:
    r = store.one("SELECT MAX(ts) AS ts FROM equity_snapshots")
    return r["ts"] if r and r["ts"] is not None else None


def mark(store, led, *, now: float | None = None, interval: float = MARK_INTERVAL) -> dict | None:
    """Append one equity mark if the newest snapshot is older than `interval`. Returns the mark or None."""
    now = time.time() if now is None else now
    last = last_mark_ts(store)
    if last is not None and now - last < interval:
        return None
    e = led.equity()
    store.execute("INSERT INTO equity_snapshots(ts,equity,cash_pnl,unrealized,open_risk) VALUES(?,?,?,?,?)",
                  (now, e["equity"], e["realized_pnl"], e["unrealized_pnl"], e["open_risk_usd"]))
    return {"ts": now, "equity": e["equity"]}


def _downsample(rows: list[dict], n: int) -> list[dict]:
    if len(rows) <= n:
        return rows
    step = (len(rows) - 1) / (n - 1)
    return [rows[round(i * step)] for i in range(n)]


def curve(store, *, days: float = 7.0, now: float | None = None, max_points: int = MAX_POINTS,
          live_equity: float | None = None) -> dict:
    """Read-only equity curve over the last `days` (plus the live equity as the last point, not stored)."""
    days = clamp_days(days)
    now = time.time() if now is None else now
    rows = store.query("SELECT ts, equity FROM equity_snapshots WHERE ts >= ? ORDER BY ts", (now - days * 86400,))
    n_total = (store.one("SELECT COUNT(*) AS n FROM equity_snapshots") or {}).get("n", 0)
    pts = [[round(r["ts"], 1), round(float(r["equity"]), 4)] for r in _downsample(rows, max_points)]
    if live_equity is not None:
        pts.append([round(now, 1), round(float(live_equity), 4)])
    ys = [p[1] for p in pts]
    out = {"points": pts, "n_marks": len(rows), "n_total": n_total, "days": days,
           "interval_sec": MARK_INTERVAL, "since": pts[0][0] if pts else None}
    if len(ys) >= 2:
        peak, mdd = ys[0], 0.0
        for y in ys:
            peak = max(peak, y)
            if peak > 0:
                mdd = max(mdd, (peak - y) / peak)
        out.update(first=ys[0], last=ys[-1], change=ys[-1] - ys[0],
                   change_pct=(ys[-1] - ys[0]) / ys[0] if ys[0] else None,
                   lo=min(ys), hi=max(ys), max_dd=mdd)
    return out


class HourlyMarker:
    """Background thread for the real `aai hud` server only. Never runs on a request; never raises into the HUD."""
    def __init__(self, store, led, interval: float = MARK_INTERVAL, poll: float = 300.0):
        self.store, self.led, self.interval, self.poll = store, led, interval, poll
        self.last_error: str | None = None
        self.last_mark: dict | None = None

    def tick(self, now: float | None = None) -> dict | None:
        try:
            m = mark(self.store, self.led, now=now, interval=self.interval)
            if m:
                self.last_mark = m
            self.last_error = None
            return m
        except Exception as e:  # pragma: no cover - defensive
            self.last_error = f"{type(e).__name__}: {e}"[:300]
            return None

    def start(self):
        def loop():
            time.sleep(45)
            while True:
                self.tick()
                time.sleep(self.poll)
        threading.Thread(target=loop, daemon=True, name="equity-marker").start()
        return self
