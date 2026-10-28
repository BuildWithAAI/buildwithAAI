"""Binder check against the dead-coin fixtures.

Five dead coins plus one live coin pass. A winners-only set is refused.
"""
from __future__ import annotations

import json

from .cohort_binder import CohortError, split_cohort
from .dead_coins import fixtures


def _episode(mint: str, fate: str, slot: int) -> dict:
    return {"mint": mint, "fate": fate, "start_slot": slot, "observations": []}


def check() -> dict:
    dead = fixtures()["coins"]
    episodes = [_episode(item["mint"], "dead", index + 1) for index, item in enumerate(dead)]
    episodes.append(_episode("live_01", "live", 99))
    bound = split_cohort({"episodes": episodes, "classification": "FIXTURE"})
    try:
        split_cohort({"episodes": [_episode(f"win_{i}", "live", i) for i in range(6)]})
    except CohortError as err:
        if str(err) != "NO_DEAD_COINS":
            raise
        refused = True
    else:
        refused = False
    if bound["dead"] < 5 or not refused:
        raise RuntimeError("BINDER_MISMATCH")
    return {"coins": bound["coins"], "dead": bound["dead"], "winners_refused": refused, "action": "NO_EXECUTION"}


if __name__ == "__main__":
    print(json.dumps(check(), sort_keys=True))
