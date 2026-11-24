"""No-trade filters from rules_draft.md (R0/R5/R6): macro blackout, indecisive close,
bias alignment, BTC filter for alts, live-price sanity vs the stated position."""
from __future__ import annotations

from bisect import bisect_left
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import yaml

from ..models import Signal


class EventCalendar:
    def __init__(self, events: list[tuple[datetime, str]], known_gaps: list[str] | None = None):
        self.events = sorted(events)
        self._ts = [e[0] for e in self.events]
        self.known_gaps = known_gaps or []

    @classmethod
    def from_yaml(cls, path: Path) -> "EventCalendar":
        raw = yaml.safe_load(Path(path).read_text())
        tz = ZoneInfo(raw.get("tz", "America/New_York"))
        out = []
        for name, spec in (raw.get("events") or {}).items():
            hh, mm = (int(x) for x in spec["time"].split(":"))
            for d in spec["dates"]:
                d = d if isinstance(d, date) else date.fromisoformat(str(d))
                out.append((datetime.combine(d, time(hh, mm), tz).astimezone(timezone.utc), name))
        return cls(out, raw.get("known_gaps"))

    def blackout(self, ts: datetime, before_h: float, after_h: float) -> str | None:
        """Event name if ts falls in [event - before_h, event + after_h]."""
        i = bisect_left(self._ts, ts - timedelta(hours=after_h))
        if i < len(self._ts) and self._ts[i] <= ts + timedelta(hours=before_h):
            return self.events[i][1]
        return None

    def upcoming(self, ts: datetime, hours: float) -> list[tuple[datetime, str]]:
        i = bisect_left(self._ts, ts)
        return [e for e in self.events[i:] if e[0] <= ts + timedelta(hours=hours)]


def btc_bias_at(ts: datetime, btc_signals: list[Signal], btc_d1: pd.DataFrame | None,
                max_age_h: float = 36) -> int:
    """BTC context known at ts: Billy's latest BTC close label if fresh, else the sign of the last
    CLOSED BTC daily candle (close vs open). Never uses information after ts."""
    best = None
    for s in btc_signals:
        if s.post_ts <= ts and (best is None or s.post_ts > best.post_ts):
            best = s
    if best is not None and (ts - best.post_ts) <= timedelta(hours=max_age_h) and best.bias != 0:
        return 1 if best.bias > 0 else -1
    if best is not None and (ts - best.post_ts) <= timedelta(hours=max_age_h):
        return 0
    if btc_d1 is not None and not btc_d1.empty:
        closed = btc_d1[btc_d1.index + pd.Timedelta(days=1) <= ts]
        if not closed.empty:
            r = closed.iloc[-1]
            return 1 if r["close"] > r["open"] else (-1 if r["close"] < r["open"] else 0)
    return 0


def position_mismatch(sig: Signal, price: float, tol_pct: float) -> bool:
    """True if a stated present-tense position contradicts the last price before the post
    (e.g. 'holding above $X' while price is >tol% below X)."""
    tol = tol_pct / 100.0
    for sp in sig.stated_positions:
        if sp.relation == "above" and price < sp.level * (1 - tol):
            return True
        if sp.relation == "below" and price > sp.level * (1 + tol):
            return True
    return False


@dataclass
class FilterContext:
    """Records why setups were rejected, for the report."""

    rejections: dict[str, int] = field(default_factory=dict)

    def reject(self, reason: str) -> None:
        self.rejections[reason] = self.rejections.get(reason, 0) + 1
