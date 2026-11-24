"""Parse-coverage statistics."""
from __future__ import annotations

from collections import Counter

from ..models import Signal


def coverage_report(signals: list[Signal]) -> dict:
    n = len(signals)
    if n == 0:
        return {"outlooks": 0}
    st = Counter(s.parse_status for s in signals)
    lab = Counter(s.close_label for s in signals)
    act = [s for s in signals if s.parse_status == "actionable"]
    pct = lambda k: round(100.0 * k / n, 1)  # noqa: E731
    return {
        "outlooks": n,
        "first_post_ts": min(s.post_ts for s in signals).isoformat(),
        "last_post_ts": max(s.post_ts for s in signals).isoformat(),
        "by_asset": dict(Counter(s.asset for s in signals)),
        "asset_detected_pct": pct(sum(s.asset != "?" for s in signals)),
        "close_label_parsed_pct": pct(n - lab.get("unknown", 0)),
        "actionable_pct": pct(st.get("actionable", 0)),
        "no_trade_pct": pct(st.get("no_trade", 0)),
        "unparsed_pct": pct(st.get("unparsed", 0)),
        "structured_pct": pct(st.get("actionable", 0) + st.get("no_trade", 0)),
        "with_target_pct_of_actionable": round(100.0 * sum(bool(s.targets) for s in act) / max(len(act), 1), 1),
        "with_explicit_trade_pct_of_actionable": round(
            100.0 * sum(s.flags.get("explicit_trade", False) for s in act) / max(len(act), 1), 1),
        "close_labels": dict(lab.most_common()),
        "condition_types": dict(Counter(s.condition_type for s in signals)),
        "directions": dict(Counter(s.direction for s in act)),
        "scenarios_total": sum(len(s.scenarios) for s in signals),
    }
