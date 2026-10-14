"""Closed-bar events with known-before-opening pivot selection."""

from bisect import bisect_right
from dataclasses import dataclass
from itertools import pairwise

from . import RULE_VERSION
from .data import HOUR, D, decimal_text, digest


@dataclass(frozen=True)
class Signal:
    id: str
    index: int
    direction: str
    pivot_index: int
    level: object
    pivot_confirmed_ms: int
    available_ms: int
    atr: object
    stop: object
    confirmation: object

    def record(self):
        return {"id": self.id, "index": self.index, "direction": self.direction,
                "pivot_index": self.pivot_index, "level": decimal_text(self.level),
                "pivot_confirmed_ms": self.pivot_confirmed_ms,
                "available_ms": self.available_ms, "atr": decimal_text(self.atr),
                "stop": decimal_text(self.stop),
                "confirmation": decimal_text(self.confirmation),
                "classification": "DERIVED_PATTERN_NOT_PROOF_OF_STOP_ORDERS"}


def contiguous(bars):
    return all(a.close_ms == b.open_ms for a, b in pairwise(bars))


def prior_atr(bars, index, cutoff, latest=None):
    if latest is None:
        latest = min(index - 1, bisect_right([b.available_ms for b in bars[:index]], cutoff) - 1)
    if latest < 20:
        return None
    window = bars[latest - 20:latest + 1]
    if not contiguous(window) or window[-1].close_ms < bars[index].open_ms - HOUR:
        return None
    ranges = [max(b.h - b.low, abs(b.h - a.c), abs(b.low - a.c))
              for a, b in pairwise(window)]
    value = sum(ranges, D(0)) / D(20)
    return value if value > 0 else None


def _pivot(bars, index, latest, direction):
    earliest_time = bars[index].open_ms - 168 * HOUR
    for j in range(min(index - 3, latest - 2), max(1, index - 170), -1):
        window = bars[j - 2:j + 3]
        if bars[j].open_ms < earliest_time or not contiguous(window):
            continue
        level = bars[j].low if direction == "BULLISH" else bars[j].h
        other = [b.low if direction == "BULLISH" else b.h
                 for n, b in enumerate(window) if n != 2]
        qualifies = all(level < x for x in other) if direction == "BULLISH" else all(
            level > x for x in other)
        if not qualifies or not contiguous(bars[j:latest + 1]):
            continue
        closes = [b.c for b in bars[j + 1:latest + 1]]
        broken = any(x < level for x in closes) if direction == "BULLISH" else any(
            x > level for x in closes)
        if not broken:
            return j, level, bars[j + 2].available_ms
    return None


def detect(dataset):
    bars = dataset.bars
    availability = [b.available_ms for b in bars]
    consumed = set()
    signals = []
    skips = {}
    for i, b in enumerate(bars):
        if i < 21:
            skips["WARMUP"] = skips.get("WARMUP", 0) + 1
            continue
        latest = min(i - 1, bisect_right(availability, b.open_ms) - 1)
        atr = prior_atr(bars, i, b.open_ms, latest)
        if atr is None or latest < 4:
            skips["MISSING_PRIOR_WINDOW"] = skips.get("MISSING_PRIOR_WINDOW", 0) + 1
            continue
        if b.available_ms - b.close_ms > HOUR:
            skips["STALE_CANDIDATE"] = skips.get("STALE_CANDIDATE", 0) + 1
            continue
        if bars[i - 1].close_ms != b.open_ms or bars[i - 1].available_ms > b.available_ms:
            skips["MISSING_PREVIOUS_CLOSE"] = skips.get("MISSING_PREVIOUS_CLOSE", 0) + 1
            continue
        found = []
        for direction in ["BULLISH", "BEARISH"]:
            pivot = _pivot(bars, i, latest, direction)
            if pivot is None:
                continue
            j, level, confirmed = pivot
            if (direction, j) in consumed:
                continue
            previous = bars[i - 1].c
            good = (previous > level and b.o >= level and
                    b.low < level - D("0.05") * atr and b.c > level
                    if direction == "BULLISH" else
                    previous < level and b.o <= level and
                    b.h > level + D("0.05") * atr and b.c < level)
            if not good:
                continue
            # Opening-time selection never silently chooses an older pivot.
            if not contiguous(bars[j:i + 1]):
                continue
            stop = b.low - D("0.10") * atr if direction == "BULLISH" else b.h + D("0.10") * atr
            if stop <= 0:
                continue
            intervening = bars[j + 1:i]
            confirmation = (max(x.h for x in intervening) if direction == "BULLISH"
                            else min(x.low for x in intervening))
            identity = {"rule": RULE_VERSION, "market": dataset.market, "open_ms": b.open_ms,
                        "direction": direction, "pivot_open_ms": bars[j].open_ms,
                        "level": decimal_text(level), "confirmed_ms": confirmed,
                        "available_ms": b.available_ms, "atr": decimal_text(atr),
                        "ohlc": [decimal_text(x) for x in [b.o, b.h, b.low, b.c]]}
            found.append(Signal(digest(identity), i, direction, j, level, confirmed,
                                b.available_ms, atr, stop, confirmation))
        if len(found) == 2:
            skips["AMBIGUOUS_TWO_SIDED"] = skips.get("AMBIGUOUS_TWO_SIDED", 0) + 1
            for s in found:
                consumed.add((s.direction, s.pivot_index))
            continue
        for s in found:
            signals.append(s)
            consumed.add((s.direction, s.pivot_index))
    return signals, skips


def trend_context(bars, cutoff, availability=None):
    if availability is None:
        availability = [b.available_ms for b in bars]
    end = bisect_right(availability, cutoff)
    if end == 0:
        return None
    latest_close = bars[end - 1].close_ms
    # At most 52 complete four-hour groups are needed for two 50-bar means.
    subset = bars[max(0, end - 212):end]
    groups = {}
    for b in subset:
        groups.setdefault((b.open_ms // (4 * HOUR)) * (4 * HOUR), []).append(b)
    complete = [(start, group[-1].c) for start, group in sorted(groups.items())
                if len(group) == 4 and contiguous(group) and group[0].open_ms == start
                and group[-1].close_ms == start + 4 * HOUR]
    if len(complete) < 51:
        return None
    last = complete[-51:]
    if any(b[0] - a[0] != 4 * HOUR for a, b in pairwise(last)):
        return None
    if latest_close - (last[-1][0] + 4 * HOUR) >= 4 * HOUR:
        return None
    average = sum((c for _, c in last[-50:]), D(0)) / D(50)
    previous = sum((c for _, c in last[:50]), D(0)) / D(50)
    return {"last_close": last[-1][1], "average": average, "previous": previous,
            "upward": last[-1][1] > average > previous}


def event_labels(dataset, signals):
    bars = dataset.bars
    opens = [b.open_ms for b in bars]
    output = []
    for s in signals:
        start = max(s.index + 1, bisect_right(opens, s.available_ms - 1))
        for horizon in [1, 4, 24, 168]:
            reason = None
            future = bars[start:start + horizon]
            if len(future) != horizon:
                reason = "INSUFFICIENT_FUTURE_OBSERVATIONS"
            elif not contiguous(future):
                reason = "GAP_IN_OUTCOME_WINDOW"
            result = {"signal_id": s.id, "horizon_bars": horizon, "classification": "LABEL",
                      "reference": "NEXT_BAR_OPEN_NOT_EXECUTABLE_QUOTE",
                      "return": None, "directional_return": None, "mae": None, "mfe": None,
                      "missing_reason": reason}
            if reason is None:
                entry = future[0].o
                raw = (future[-1].c - entry) / entry
                bull = s.direction == "BULLISH"
                result.update(return_=decimal_text(raw))
                result["return"] = result.pop("return_")
                result["directional_return"] = decimal_text(raw if bull else -raw)
                result["mae"] = decimal_text((min(b.low for b in future) - entry) / entry if bull
                                             else (entry - max(b.h for b in future)) / entry)
                result["mfe"] = decimal_text((max(b.h for b in future) - entry) / entry if bull
                                             else (entry - min(b.low for b in future)) / entry)
            output.append(result)
    return output
