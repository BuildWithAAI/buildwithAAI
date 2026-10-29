"""Bind a multi-coin archive to the first-brain feature contract.

Accepts episodes already shaped for feature_loader. Splits by coin start
time, keeps dead coins, and scores the last window once. It does not
contact a network and does not send an order.
"""
from __future__ import annotations

import json
from typing import Iterable

from .feature_loader import features_from_observations, label_adverse

MIN_COINS = 6
MIN_DEAD = 1
HORIZON_ROWS = 1


class CohortError(ValueError):
    pass


def _episodes(archive: dict) -> list[dict]:
    episodes = archive.get("episodes")
    if type(episodes) is not list or not episodes:
        raise CohortError("NO_EPISODES")
    return episodes


def split_cohort(archive: dict) -> dict:
    episodes = sorted(_episodes(archive), key=lambda item: (item.get("start_slot", 0), item.get("mint", "")))
    if len(episodes) < MIN_COINS:
        raise CohortError("COHORT_TOO_SMALL")
    dead = [item for item in episodes if item.get("fate") == "dead"]
    if len(dead) < MIN_DEAD:
        raise CohortError("NO_DEAD_COINS")
    cut_train = len(episodes) // 3
    cut_test = len(episodes) - cut_train
    for index, episode in enumerate(episodes):
        if index < cut_train:
            episode["split"] = "train"
        elif index < cut_test:
            episode["split"] = "threshold"
        else:
            episode["split"] = "test"
    return {
        "classification": archive.get("classification", "UNSPECIFIED"),
        "coins": len(episodes),
        "dead": len(dead),
        "splits": {
            "train": cut_train,
            "threshold": cut_test - cut_train,
            "test": len(episodes) - cut_test,
        },
        "episodes": episodes,
        "action": "NO_EXECUTION",
    }


def rows_for(episode: dict, split: str) -> list[tuple[tuple[float, float, float, float], int]]:
    observations = episode.get("observations")
    if type(observations) is not list:
        raise CohortError("NO_OBSERVATIONS")
    rows = []
    for index in range(len(observations)):
        label = label_adverse(observations, index, HORIZON_ROWS)
        if label is None:
            continue
        rows.append((features_from_observations(observations, index), label))
    if not rows:
        raise CohortError("NO_LABELED_ROWS")
    return rows


def score_three_way(archive: dict) -> dict:
    bound = split_cohort(archive)
    test = [episode for episode in bound["episodes"] if episode["split"] == "test"]
    calls = 0
    for episode in test:
        calls += len(rows_for(episode, "test"))
    real = archive.get("classification") == "AAI_OBSERVED_TRADE_DATASET"
    return {
        "classification": bound["classification"],
        "coins": bound["coins"],
        "dead": bound["dead"],
        "test_calls": calls,
        "scratch": "NOT_SCORED_UNTIL_GRAPH_BOUND",
        "preloaded": "NOT_SCORED_UNTIL_PRIOR_BOUND",
        "no_trade": "ABSTAIN_ALL",
        "market_skill": "NOT_ESTABLISHED" if not real else "PENDING_UNTOUCHED_WINDOW",
        "action": "NO_EXECUTION",
    }


def self_check() -> dict:
    def episode(mint: str, fate: str, slot: int) -> dict:
        price = 1.0
        observations = []
        for step in range(4):
            if fate == "dead":
                price *= 0.7
            elif fate == "runner":
                price *= 1.05
            observations.append({
                "last_trade_price": price,
                "quote_atoms": 1000 + step,
                "signed_quote_flow": -10 if fate == "dead" else 5,
            })
        return {"mint": mint, "fate": fate, "start_slot": slot, "observations": observations}

    archive = {
        "classification": "SYNTHETIC_STAND_IN",
        "episodes": [
            episode("a", "dead", 1),
            episode("b", "runner", 2),
            episode("c", "flat", 3),
            episode("d", "dead", 4),
            episode("e", "runner", 5),
            episode("f", "flat", 6),
        ],
    }
    scored = score_three_way(archive)
    if scored["dead"] < 1 or scored["action"] != "NO_EXECUTION":
        raise CohortError("SELF_CHECK")
    thin = {"classification": "SYNTHETIC_STAND_IN", "episodes": archive["episodes"][:2]}
    try:
        split_cohort(thin)
    except CohortError as err:
        if str(err) != "COHORT_TOO_SMALL":
            raise
    else:
        raise CohortError("SMALL_COHORT_ACCEPTED")
    return scored


if __name__ == "__main__":
    print(json.dumps(self_check(), sort_keys=True))
