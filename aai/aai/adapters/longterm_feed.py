"""Manual CSV long-term holdings feed (audit-only).

Replaces the Placeholder once wired: surfaces whether `lt_holdings_snapshots` has rows,
never invents balances, never drafts tickets. Writers are CLI-only
(`aai lt-holdings-import`); the HUD / voice / LLM only read.
"""
from __future__ import annotations

import time

from .base import Adapter
from .. import longterm as lt

SOURCE = "manual CSV via `aai lt-holdings-import` (source=manual) (audit-only, append-only snapshots)"
NOTE = "OnePay Roth stays user-executed. Import never produces order tickets."
STALE_AFTER = 48 * 3600  # freshness panel uses 48h; same budget here for STALE


class LongtermFeedAdapter(Adapter):
    """Read-only view of manually imported holdings snapshots. Never writes."""

    name, sector = "longterm_holdings_feed", "longterm"
    placeholder = False

    def panel(self, now: float | None = None) -> dict:
        now = now if now is not None else time.time()
        if self.store is None:
            return {"state": "MISSING", "detail": "no store", "source": SOURCE, "note": NOTE,
                    "holdings_source": "none", "accounts": [], "n_rows": 0, "as_of": None, "age_sec": None,
                    "stale_after_sec": STALE_AFTER}
        rows = lt.latest_holdings(self.store)
        src = lt.holdings_source(self.store)
        if not rows:
            return {"state": "MISSING", "detail": "no holdings snapshot; import with aai lt-holdings-import FILE --account onepay_roth",
                    "source": SOURCE, "note": NOTE, "holdings_source": "none", "accounts": [], "n_rows": 0,
                    "as_of": None, "age_sec": None, "stale_after_sec": STALE_AFTER}
        by_acct: dict[str, list] = {}
        for r in rows:
            by_acct.setdefault(r["account_id"], []).append(r)
        accounts = []
        newest = max(float(r["as_of"]) for r in rows)
        for aid, rs in sorted(by_acct.items()):
            vals = [r["value_usd"] for r in rs if r.get("value_usd") is not None]
            accounts.append({
                "id": aid,
                "n": len(rs),
                "symbols": [str(r["symbol"])[:24] for r in rs][:40],
                "total_value_usd": (round(sum(vals), 2) if len(vals) == len(rs) else None),
                "as_of": max(float(r["as_of"]) for r in rs),
                "source": str(rs[0].get("source") or "")[:40],
                "verified": all(bool(r.get("verified")) for r in rs),
            })
        age = max(0.0, now - newest)
        state = "STALE" if age > STALE_AFTER else "OK"
        detail = (f"{len(rows)} holdings across {len(accounts)} account{'s' if len(accounts) != 1 else ''}"
                  f" · source {src}" + (" · values incomplete" if any(a["total_value_usd"] is None for a in accounts) else ""))
        return {"state": state, "detail": detail[:200], "source": SOURCE, "note": NOTE,
                "holdings_source": src, "accounts": accounts, "n_rows": len(rows),
                "as_of": newest, "age_sec": round(age), "stale_after_sec": STALE_AFTER}

    def health(self) -> dict:
        p = self.panel()
        st = p["state"]
        return {"ok": st == "OK", "status": {"OK": "pass", "STALE": "stale", "MISSING": "missing"}.get(st, "missing"),
                "detail": p["detail"], "holdings_source": p["holdings_source"], "n_rows": p["n_rows"],
                "age_sec": p["age_sec"], "checked_at": time.time()}
