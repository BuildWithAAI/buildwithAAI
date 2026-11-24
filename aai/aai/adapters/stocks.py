"""Read-only US equity quotes for the stocks desk (Yahoo via the intel `markets` cache).

No stocks idea agent exists on this box, so this adapter never invents ideas or places
orders. It only surfaces equity-class rows already fetched by aai/intel (SPY/QQQ/IWM)
with their real timestamps and LIVE/STALE/MISSING state. Paper only.
"""
from __future__ import annotations

import time

from .base import Adapter
from ..intel.cache import IntelCache
from ..intel.feeds import registry as intel_feeds

# Equity symbols the stocks desk cares about (subset of yahoo.SYMBOLS class=equity).
EQUITY_SYMBOLS = ("SPY", "QQQ", "IWM")
SOURCE = "Yahoo Finance chart API via intel markets (keyless, unofficial)"
NOTE = "Equities/ETFs may be up to 15 min delayed; closed markets keep the last session close. No stocks idea agent."


def _stale_budget() -> float:
    feeds = intel_feeds()
    m = feeds.get("markets")
    return float(getattr(m, "budget", 20 * 60) or 20 * 60)


def _row(r: dict) -> dict | None:
    if not isinstance(r, dict):
        return None
    sym = str(r.get("symbol") or "")[:12]
    if sym not in EQUITY_SYMBOLS and str(r.get("class") or "") != "equity":
        return None
    if sym not in EQUITY_SYMBOLS:
        # only the desk watchlist; ignore other equity-class symbols if added later
        return None
    last = r.get("last")
    if not isinstance(last, (int, float)):
        return None
    out = {
        "symbol": sym,
        "name": str(r.get("name") or "")[:48],
        "yahoo": str(r.get("yahoo") or "")[:24],
        "last": float(last),
        "prev_close": float(r["prev_close"]) if isinstance(r.get("prev_close"), (int, float)) else None,
        "chg": float(r["chg"]) if isinstance(r.get("chg"), (int, float)) else None,
        "chg_20d": float(r["chg_20d"]) if isinstance(r.get("chg_20d"), (int, float)) else None,
        "ts": float(r["ts"]) if isinstance(r.get("ts"), (int, float)) else None,
        "currency": str(r.get("currency") or "USD")[:4],
    }
    spark = r.get("spark")
    if isinstance(spark, list) and spark:
        # keep a short spark for the HUD; numbers only
        pts = []
        for p in spark[-30:]:
            if isinstance(p, (list, tuple)) and len(p) >= 2 and isinstance(p[1], (int, float)):
                pts.append([float(p[0]) if isinstance(p[0], (int, float)) else None, float(p[1])])
        if pts:
            out["spark"] = pts
    return out


class StocksAdapter(Adapter):
    """Read-only equity quotes from the intel markets SQLite cache. Never writes, never ideas."""

    name, sector = "stocks", "stocks"
    placeholder = False

    def __init__(self, cfg, store=None):
        super().__init__(cfg, store)
        self.cache = IntelCache(store) if store is not None else None

    def quotes(self, now: float | None = None) -> dict:
        """Panel + API shape: state, age, source, equity quotes. Empty when no cache yet."""
        now = now if now is not None else time.time()
        if self.cache is None:
            return {"state": "MISSING", "detail": "no store", "quotes": [], "source": SOURCE, "note": NOTE,
                    "age_sec": None, "fetched_at": None, "stale_after_sec": _stale_budget()}
        snap = self.cache.latest_ok("markets")
        if not snap:
            st = self.cache.state("markets")
            err = (st.get("last_error") or "")[:160]
            return {"state": "MISSING", "detail": err or "no Yahoo markets snapshot yet", "quotes": [],
                    "source": SOURCE, "note": NOTE, "age_sec": None, "fetched_at": None,
                    "stale_after_sec": _stale_budget()}
        rows = (snap.get("payload") or {}).get("rows") or []
        quotes = []
        for r in rows:
            q = _row(r)
            if q:
                quotes.append(q)
        # stable watchlist order
        order = {s: i for i, s in enumerate(EQUITY_SYMBOLS)}
        quotes.sort(key=lambda q: order.get(q["symbol"], 99))
        fetched = float(snap["fetched_at"])
        age = max(0.0, now - fetched)
        budget = _stale_budget()
        stale = age > budget
        if not quotes:
            state, detail = "MISSING", "markets snapshot has no equity rows (SPY/QQQ/IWM)"
        elif stale:
            state, detail = "STALE", f"{len(quotes)} equity quotes · {int(age)}s old (budget {int(budget)}s)"
        else:
            state, detail = "OK", f"{len(quotes)} equity quotes · Yahoo via intel · no idea agent"
        return {"state": state, "detail": detail, "quotes": quotes, "source": SOURCE, "note": NOTE,
                "age_sec": round(age, 1), "fetched_at": fetched, "stale_after_sec": budget,
                "feed_source": str(snap.get("source") or "")[:80]}

    def health(self) -> dict:
        q = self.quotes()
        ok = q["state"] == "OK"
        # STALE is still a real quote source — report ok=False with status=stale so the
        # optional healthcheck banner shows, without pretending the desk is unbuilt.
        status = {"OK": "pass", "STALE": "stale", "MISSING": "missing"}.get(q["state"], q["state"].lower())
        return {"ok": ok, "status": status, "detail": q["detail"], "n_quotes": len(q["quotes"]),
                "symbols": [x["symbol"] for x in q["quotes"]], "age_sec": q["age_sec"],
                "source": q["source"], "checked_at": time.time()}

    def ideas(self) -> list:
        """No stocks idea agent on this computer — never invent."""
        return []
