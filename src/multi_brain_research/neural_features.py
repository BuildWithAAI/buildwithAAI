"""Standard-library contract for the AAI.fun frozen FlyVis feature export."""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path

from . import training_lab as lab
from .flyvis_reference import CONNECTOME_SHA256, UPSTREAM_COMMIT, load_registration

ROOT = Path(__file__).resolve().parents[2]
CORE_STATE_SHA256 = "b8a043760e32fd5b475f031184fe9800f8b8317c4497f05b84c1bb61f15b184b"
HEX_ENCODER = {"version": "CAUSAL_HEX_STRIPES_V1", "dt": 0.005, "hexals": 721,
               "feature_cycle": 5, "baseline": 0.5, "amplitude": 0.45,
               "reset": "UPSTREAM_INITIAL_STATE_PER_EPISODE_NO_GRAY_WARMUP",
               "neural_time_is_market_time": False}
MAX_EPISODES, MAX_ROWS_PER_EPISODE, MAX_TOTAL_ROWS = 64, 512, 2048


def encoder(input_schema):
    return {"version": "AAI_TRADE_FLYVIS_ENCODER_V1", "visual_encoder": deepcopy(HEX_ENCODER),
            "input_schema_sha256": lab.digest(input_schema),
            "observation": "ONE_MARKET_PER_COMPLETE_TRANSACTION",
            "raw_features_appended": False}


def expected_pipeline(input_schema):
    registration = load_registration(ROOT / "experiments/flyvis_trained_reference/registration.json")
    labels = [label for label in registration["network"]["labels"]
              if label not in {f"R{i}" for i in range(1, 9)}]
    return {"kind": "FROZEN_FLYVIS_TRADE_ACTIVITY_V1", "upstream_commit": UPSTREAM_COMMIT,
            "checkpoint_sha256": registration["model_member_sha256"],
            "connectome_sha256": CONNECTOME_SHA256, "core_state_sha256": CORE_STATE_SHA256,
            "encoder": encoder(input_schema), "readout_cell_types": labels,
            "activity_units": "MODEL_ACTIVITY_UNITS_UNCALIBRATED",
            "execution_attestation": "NOT_ESTABLISHED"}


def check_bounds(data):
    lab.require(data.get("protocol") == "AAI_OBSERVED_TRADE_DATASET_V1", "NEURAL_DATASET_PROTOCOL")
    episodes = data["episodes"]
    lab.require(type(episodes) is list and 1 <= len(episodes) <= MAX_EPISODES, "NEURAL_EPISODE_BOUND")
    total = 0
    for episode in episodes:
        rows = episode["observations"]
        lab.require(type(rows) is list and 1 <= len(rows) <= MAX_ROWS_PER_EPISODE, "NEURAL_ROW_BOUND")
        total += len(rows)
        lab.require(total <= MAX_TOTAL_ROWS, "NEURAL_TOTAL_ROW_BOUND")


def check_input_rows(rows):
    lab.require(type(rows) is list and 1 <= len(rows) <= MAX_ROWS_PER_EPISODE, "NEURAL_INPUT_BOUND")
    for row in rows:
        lab.require(type(row) is list and len(row) == 5, "NEURAL_INPUT_WIDTH")
        for value in row:
            lab.finite(value, -1, 1)


def validate_bundle(bundle, data, input_schema):
    check_bounds(data)
    lab.exact(bundle, ("protocol", "classification", "dataset_sha256", "pipeline", "features"))
    lab.require(bundle["protocol"] == "AAI_TRADE_NEURAL_FEATURES_V1"
                and bundle["classification"] == data["classification"]
                and bundle["dataset_sha256"] == lab.digest(data), "NEURAL_DATASET_BINDING")
    lab.require(lab.canonical(bundle["pipeline"]) == lab.canonical(expected_pipeline(input_schema)),
                "NEURAL_PIPELINE_BINDING")
    members = bundle["features"]
    lab.require(type(members) is dict and set(members) == {e["episode_id"] for e in data["episodes"]},
                "NEURAL_EPISODE_BINDING")
    for episode in data["episodes"]:
        values = members[episode["episode_id"]]
        lab.require(type(values) is list and len(values) == len(episode["observations"]), "NEURAL_ROW_ALIGNMENT")
        for row in values:
            lab.require(type(row) is list and len(row) == 57, "NEURAL_OUTPUT_WIDTH")
            for value in row:
                lab.finite(value)
    return members


def export(data, input_schema, feature_function, activity_function):
    """The caller supplies audited functions; this schema does not attest execution."""
    check_bounds(data)
    members = {}
    for episode in data["episodes"]:
        rows = [feature_function(episode, index) for index in range(len(episode["observations"]))]
        check_input_rows(rows)
        members[episode["episode_id"]] = activity_function(rows)
    bundle = {"protocol": "AAI_TRADE_NEURAL_FEATURES_V1", "classification": data["classification"],
              "dataset_sha256": lab.digest(data), "pipeline": expected_pipeline(input_schema), "features": members}
    validate_bundle(bundle, data, input_schema)
    return bundle
