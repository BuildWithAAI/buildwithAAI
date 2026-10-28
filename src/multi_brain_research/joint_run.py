"""One pass from a synthetic cohort to a hired receipt.

Uses the existing compare contract. Does not claim market skill.
"""
from __future__ import annotations

import hashlib
import json

from .agent_hire import hire
from .cohort_binder import score_three_way
from .control_brains import frozen_prior, no_trade
from .contracts import Snapshot, Measurement, compare
from .receipt_bridge import to_module_output

FEATURE_SET = hashlib.sha256(b"joint_features_v1").hexdigest()
LINEAGE = hashlib.sha256(b"synthetic_lineage").hexdigest()


def _snapshot() -> Snapshot:
    measurement = Measurement(
        feature_id="M-001",
        value=0,
        unit="signed_return_ppm",
        classification="SYNTHETIC",
        event_time_ms=1_000,
        observed_time_ms=1_000,
        available_time_ms=1_000,
        source_id="research_joint",
        source_version="joint_v1",
        lineage_sha256=LINEAGE,
        missing_reason=None,
    )
    return Snapshot(
        entity_id="coin_fixture",
        decision_time_ms=1_000,
        feature_set_sha256=FEATURE_SET,
        max_observation_age_ms=60_000,
        measurements=(measurement,),
    )


def run() -> dict:
    archive = {
        "classification": "SYNTHETIC_STAND_IN",
        "episodes": [
            {"mint": f"c{i}", "fate": fate, "start_slot": i, "observations": [
                {"last_trade_price": 1.0, "quote_atoms": 1000, "signed_quote_flow": 0},
                {"last_trade_price": 0.8 if fate == "dead" else 1.0, "quote_atoms": 900, "signed_quote_flow": -1},
            ]}
            for i, fate in enumerate(("dead", "runner", "flat", "dead", "runner", "flat"))
        ],
    }
    cohort = score_three_way(archive)
    features = (-0.2, -0.1, -0.1, 0.15)
    snapshot = _snapshot()
    receipts = (
        to_module_output(no_trade(features), snapshot.sha256(), 1_100),
        to_module_output(frozen_prior(features), snapshot.sha256(), 1_100),
    )
    comparison = compare(receipts, snapshot)
    decision = hire(comparison, 100, 40)
    return {
        "cohort": cohort,
        "comparison": comparison,
        "hire": decision,
        "market_skill": "NOT_ESTABLISHED",
        "action": "NO_EXECUTION",
    }


if __name__ == "__main__":
    print(json.dumps(run(), sort_keys=True))
