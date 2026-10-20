"""Causal episode preparation and actual supervised readout fitting; no orders or network."""

from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import random
import re

LIMIT = 16_000_000
PARTS = ("train", "validation", "test")
TASK = "FUTURE_MID_DIRECTION_NOT_EXECUTABLE_RETURN_V1"
FEATURES = ("return_one", "return_three", "spread", "depth_imbalance", "depth_magnitude")


class TrainingError(ValueError):
    pass


def require(condition, reason):
    if not condition:
        raise TrainingError(reason)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def exact(value, names):
    require(type(value) is dict and set(value) == set(names), "INVALID_FIELDS")


def integer(value, low=0, high=10**18):
    require(type(value) is int and low <= value <= high, "INVALID_INTEGER")
    return value


def finite(value, low=-1e6, high=1e6):
    require(type(value) in (int, float) and math.isfinite(value) and low <= value <= high, "INVALID_NUMBER")
    return value


def name(value):
    require(type(value) is str and re.fullmatch(r"[a-z][a-z0-9_]{2,63}", value) is not None, "INVALID_NAME")
    return value


def pin(value):
    require(type(value) is str and re.fullmatch(r"[0-9a-f]{64}", value) is not None and value != "0" * 64,
            "INVALID_PIN")
    return value


def read_json(path):
    path = Path(path)
    require(path.is_file() and not path.is_symlink() and 0 < path.stat().st_size <= LIMIT, "INVALID_FILE")

    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, "DUPLICATE_JSON_KEY")
            result[key] = value
        return result

    raw = path.read_bytes()
    require(len(raw) <= LIMIT, "FILE_TOO_LARGE")
    try:
        return json.loads(raw, object_pairs_hook=pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(TrainingError("NONFINITE_JSON")))
    except (json.JSONDecodeError, UnicodeError, RecursionError) as error:
        raise TrainingError("INVALID_JSON") from error


def write_json(path, value):
    raw = (canonical(value) + "\n").encode()
    require(len(raw) <= LIMIT, "OUTPUT_TOO_LARGE")
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(descriptor, "wb") as stream:
        require(stream.write(raw) == len(raw), "SHORT_WRITE")
        stream.flush()
        os.fsync(stream.fileno())
    return hashlib.sha256(raw).hexdigest()


def validate_dataset(data):
    exact(data, ("protocol", "classification", "source", "units", "episodes"))
    require(data["protocol"] == "AAI_EPISODE_DATASET_V1", "DATASET_PROTOCOL")
    require(data["classification"] in ("SYNTHETIC_FIXTURE", "RECORDED_UNVERIFIED"), "DATASET_CLASSIFICATION")
    exact(data["source"], ("uri", "content_sha256", "rights"))
    require(type(data["source"]["uri"]) is str and 1 <= len(data["source"]["uri"]) <= 512, "SOURCE_REQUIRED")
    pin(data["source"]["content_sha256"])
    require(data["source"]["rights"] == "DECLARED_PERMITTED", "SOURCE_RIGHTS_UNRESOLVED")
    exact(data["units"], ("quote_unit", "base_scale", "price_unit", "depth_unit"))
    name(data["units"]["quote_unit"])
    require(type(data["units"]["base_scale"]) is int
            and data["units"]["base_scale"] in tuple(10**n for n in range(19))
            and data["units"]["price_unit"] == "QUOTE_UNITS_PER_WHOLE_BASE"
            and data["units"]["depth_unit"] == "BASE_ATOMS", "INVALID_DATASET_UNITS")
    require(type(data["episodes"]) is list and 3 <= len(data["episodes"]) <= 64, "EPISODE_BOUND")
    seen, trajectories, total = set(), set(), 0
    for episode in data["episodes"]:
        exact(episode, ("episode_id", "asset_group_sha256", "quotes"))
        key = name(episode["episode_id"])
        require(key not in seen, "DUPLICATE_EPISODE")
        seen.add(key)
        pin(episode["asset_group_sha256"])
        quotes = episode["quotes"]
        require(type(quotes) is list and 4 <= len(quotes) <= 512, "QUOTE_BOUND")
        total += len(quotes)
        require(total <= 8192, "DATASET_BOUND")
        trajectory = digest(quotes)
        require(trajectory not in trajectories, "DUPLICATE_TRAJECTORY")
        trajectories.add(trajectory)
        last_event, last_available = -1, -1
        for quote in quotes:
            exact(quote, ("event_ms", "available_ms", "bid", "ask", "bid_size", "ask_size"))
            event, available = integer(quote["event_ms"]), integer(quote["available_ms"])
            require(last_event < event <= available and last_available < available, "NONCAUSAL_QUOTE_ORDER")
            integer(quote["bid"], 1)
            integer(quote["ask"], quote["bid"])
            integer(quote["bid_size"])
            integer(quote["ask_size"])
            last_event, last_available = event, available
    return {episode["episode_id"]: episode for episode in data["episodes"]}


def validate_plan(plan, data):
    exact(plan, ("protocol", "dataset_sha256", "horizon_ms", "shuffle_seed", "alias_salt", "splits",
                 "epochs", "learning_rate", "l2"))
    require(plan["protocol"] == "AAI_READOUT_PLAN_V1" and plan["dataset_sha256"] == digest(data),
            "DATASET_PIN_MISMATCH")
    integer(plan["horizon_ms"], 1, 86_400_000)
    integer(plan["shuffle_seed"], 0, 2**32 - 1)
    pin(plan["alias_salt"])
    integer(plan["epochs"], 1, 2000)
    finite(plan["learning_rate"], 0.00001, 1)
    finite(plan["l2"], 0, 1)
    exact(plan["splits"], PARTS)
    episodes = validate_dataset(data)
    assigned, groups = set(), {}
    for part in PARTS:
        members = plan["splits"][part]
        require(type(members) is list and 1 <= len(members) <= 64, "EMPTY_SPLIT")
        groups[part] = set()
        for key in members:
            require(key in episodes and key not in assigned, "INVALID_SPLIT_MEMBERSHIP")
            assigned.add(key)
            groups[part].add(episodes[key]["asset_group_sha256"])
    require(assigned == set(episodes), "UNASSIGNED_EPISODE")
    for left, right in (("train", "validation"), ("train", "test"), ("validation", "test")):
        require(not groups[left] & groups[right], "ASSET_GROUP_LEAKAGE")
        end = max(episodes[key]["quotes"][-1]["available_ms"] for key in plan["splits"][left])
        start = min(episodes[key]["quotes"][0]["available_ms"] for key in plan["splits"][right])
        require(end + plan["horizon_ms"] < start, "CHRONOLOGY_OR_HORIZON_GAP")
    return episodes


def raw_features(quotes, index):
    current = quotes[index]
    mid = current["bid"] + current["ask"]
    previous = quotes[max(0, index - 1)]
    older = quotes[max(0, index - 3)]
    prior, old = previous["bid"] + previous["ask"], older["bid"] + older["ask"]
    depth = current["bid_size"] + current["ask_size"]
    def clip(x):
        return max(-1.0, min(1.0, x))
    return [clip(20 * (mid - prior) / prior), clip(10 * (mid - old) / old),
            min(1.0, 100 * (current["ask"] - current["bid"]) / mid),
            (current["bid_size"] - current["ask_size"]) / max(1, depth),
            min(1.0, math.log1p(depth) / 45)]


def observation(episode, index, plan):
    integer(index, 0, len(episode["quotes"]) - 1)
    alias = "sim_" + digest({"salt": plan["alias_salt"], "episode": episode["episode_id"]})[:16]
    quote = episode["quotes"][index]
    # Exact allowlist: no source identity, future quote, label or episode ending time.
    return {"alias": alias, "sequence": index, "event_ms": quote["event_ms"],
            "available_ms": quote["available_ms"], "bid": quote["bid"], "ask": quote["ask"],
            "features": raw_features(episode["quotes"], index)}


def validate_bundle(bundle, data, episodes):
    exact(bundle, ("protocol", "dataset_sha256", "pipeline", "features"))
    require(bundle["protocol"] == "AAI_FEATURE_EXPORT_V1" and bundle["dataset_sha256"] == digest(data),
            "FEATURE_DATASET_MISMATCH")
    exact(bundle["pipeline"], ("kind", "source_sha256", "encoder_sha256", "core_state_sha256"))
    require(bundle["pipeline"]["kind"] in ("RAW_FEATURE_CONTROL", "FROZEN_FLYVIS_ACTIVITY"),
            "UNSUPPORTED_FEATURE_PIPELINE")
    for key in ("source_sha256", "encoder_sha256", "core_state_sha256"):
        pin(bundle["pipeline"][key])
    require(type(bundle["features"]) is dict and set(bundle["features"]) == set(episodes), "FEATURE_EPISODE_MISMATCH")
    width = None
    for key, episode in episodes.items():
        rows = bundle["features"][key]
        require(type(rows) is list and len(rows) == len(episode["quotes"]), "FEATURE_ROW_MISMATCH")
        for row in rows:
            require(type(row) is list and 1 <= len(row) <= 128, "FEATURE_WIDTH")
            width = len(row) if width is None else width
            require(len(row) == width, "FEATURE_WIDTH")
            for value in row:
                finite(value)
    return width


def raw_bundle(data):
    episodes = validate_dataset(data)
    return {"protocol": "AAI_FEATURE_EXPORT_V1", "dataset_sha256": digest(data),
            "pipeline": {"kind": "RAW_FEATURE_CONTROL", "source_sha256": digest(FEATURES),
                         "encoder_sha256": digest("CAUSAL_QUOTE_FEATURES_V1"),
                         "core_state_sha256": digest("NO_BIOLOGICAL_CORE")},
            "features": {key: [raw_features(e["quotes"], i) for i in range(len(e["quotes"]))]
                         for key, e in episodes.items()}}


def examples(data, plan, bundle):
    episodes = validate_plan(plan, data)
    validate_bundle(bundle, data, episodes)
    result = {}
    for part in PARTS:
        order = list(plan["splits"][part])
        random.Random(plan["shuffle_seed"] + PARTS.index(part)).shuffle(order)
        rows = []
        for key in order:
            episode = episodes[key]
            quotes = episode["quotes"]
            for index, quote in enumerate(quotes):
                target = next((j for j in range(index + 1, len(quotes))
                               if quotes[j]["event_ms"] >= quote["available_ms"] + plan["horizon_ms"]), None)
                if target is None:
                    continue  # Future outcome absent: never invent a label.
                later = quotes[target]
                rows.append({"episode_id": key, "index": index, "target_index": target,
                             "x": bundle["features"][key][index],
                             "y": int(later["bid"] + later["ask"] > quote["bid"] + quote["ask"])})
        require(len(rows) >= 4, "INSUFFICIENT_SPLIT_EXAMPLES")
        result[part] = rows
    require({row["y"] for row in result["train"]} == {0, 1}, "TRAIN_LABEL_CLASS_MISSING")
    return result


def sigmoid(value):
    value = max(-40.0, min(40.0, value))
    return 1 / (1 + math.exp(-value))


def probability(model, row):
    require(type(row) is list and len(row) == len(model["weights"]), "PREDICT_WIDTH")
    values = [(finite(x) - mean) / scale for x, mean, scale in zip(row, model["means"], model["scales"])]
    values = [max(-6.0, min(6.0, x)) for x in values]
    return sigmoid(model["bias"] + sum(w * x for w, x in zip(model["weights"], values)))


def metrics(model, rows, constant=None):
    probabilities = [constant if constant is not None else probability(model, row["x"]) for row in rows]
    return {"examples": len(rows),
            "log_loss": -sum(row["y"] * math.log(max(1e-12, p))
                             + (1 - row["y"]) * math.log(max(1e-12, 1 - p))
                             for row, p in zip(rows, probabilities)) / len(rows),
            "brier": sum((p - row["y"])**2 for row, p in zip(rows, probabilities)) / len(rows),
            "accuracy": sum((p >= 0.5) == bool(row["y"]) for row, p in zip(rows, probabilities)) / len(rows)}


def fit(data, plan, bundle):
    partitions = examples(data, plan, bundle)
    rows = partitions["train"]
    width, count = len(rows[0]["x"]), len(rows)
    means = [sum(row["x"][j] for row in rows) / count for j in range(width)]
    scales = [max(1e-6, math.sqrt(sum((row["x"][j] - means[j])**2 for row in rows) / count))
              for j in range(width)]
    model = {"protocol": "AAI_LOGISTIC_READOUT_V1", "task": TASK,
             "dataset_sha256": digest(data), "plan_sha256": digest(plan),
             "feature_pipeline_sha256": digest(bundle["pipeline"]), "feature_export_sha256": digest(bundle),
             "units": dict(data["units"]),
             "means": means, "scales": scales, "weights": [0.0] * width, "bias": 0.0,
             "live_execution_allowed": False, "calibration": "NOT_ESTABLISHED"}
    initial = metrics(model, rows)
    initial_hash = digest(model)
    normalized = [[max(-6.0, min(6.0, (x - m) / s)) for x, m, s in zip(row["x"], means, scales)] for row in rows]
    for _ in range(plan["epochs"]):
        errors = [sigmoid(model["bias"] + sum(w * x for w, x in zip(model["weights"], values))) - row["y"]
                  for row, values in zip(rows, normalized)]
        gradients = [sum(error * values[j] for error, values in zip(errors, normalized)) / count
                     + plan["l2"] * model["weights"][j] for j in range(width)]
        model["weights"] = [w - plan["learning_rate"] * g for w, g in zip(model["weights"], gradients)]
        model["bias"] -= plan["learning_rate"] * sum(errors) / count
    for value in model["weights"] + [model["bias"]]:
        finite(value, -1e4, 1e4)
    prior = sum(row["y"] for row in rows) / count
    report = {"protocol": "AAI_READOUT_TRAINING_REPORT_V1", "classification": data["classification"],
              "task": TASK, "pipeline": bundle["pipeline"], "initial_model_sha256": initial_hash,
              "model_sha256": digest(model), "readout_parameters_changed": initial_hash != digest(model),
              "initial_train_metrics": initial,
              "metrics": {part: metrics(model, partitions[part]) for part in PARTS},
              "train_prior_baseline": {part: metrics(model, partitions[part], prior) for part in PARTS},
              "training_performed": True, "trained_components": ["LOGISTIC_READOUT"],
              "biological_core_weights_updated": False, "market_validation_established": False,
              "execution_attestation": "NOT_ESTABLISHED", "calibration": "NOT_ESTABLISHED",
              "profitability": "NOT_EVALUATED", "live_execution_allowed": False}
    return model, report


def public_trace(data, plan, bundle, model):
    partitions = examples(data, plan, bundle)
    require(model["plan_sha256"] == digest(plan) and model["feature_export_sha256"] == digest(bundle),
            "MODEL_INPUT_BINDING")
    episodes = {e["episode_id"]: e for e in data["episodes"]}
    events, previous = [], "0" * 64
    order = list(plan["splits"]["test"])
    random.Random(plan["shuffle_seed"] + 2).shuffle(order)
    for key in order:
        episode = episodes[key]
        rows = {r["index"]: r for r in partitions["test"] if r["episode_id"] == key}
        due = {}
        for index in range(len(episode["quotes"])):
            # A matured outcome is released only at its actual later quote.
            for original in due.pop(index, []):
                events.append({"type": "OUTCOME", "alias": observation(episode, index, plan)["alias"],
                               "sequence": index, "decision_sequence": original["index"], "label": original["y"]})
            visible = observation(episode, index, plan)
            events.append({"type": "OBSERVATION", **visible})
            if index in rows:
                row = rows[index]
                events.append({"type": "PREDICTION", "alias": visible["alias"], "sequence": index,
                               "model_sha256": digest(model), "probability_ppm": round(probability(model, row["x"]) * 1_000_000),
                               "action": "NO_EXECUTION", "calibration": "NOT_ESTABLISHED"})
                due.setdefault(row["target_index"], []).append(row)
    linked = []
    for event in events:
        item = {"previous_sha256": previous, "event": event}
        previous = digest(item)
        linked.append({**item, "sha256": previous})
    return {"protocol": "AAI_CAUSAL_PUBLIC_TRACE_V1", "classification": data["classification"],
            "units": dict(data["units"]),
            "model_sha256": digest(model), "events": linked, "head_sha256": previous,
            "blinding": "ALIASES_ONLY_NOT_AN_INDEPENDENT_HOLDOUT", "live_execution_allowed": False}


def run(data, plan, output, bundle=None):
    validate_plan(plan, data)
    bundle = raw_bundle(data) if bundle is None else bundle
    model, report = fit(data, plan, bundle)
    trace = public_trace(data, plan, bundle, model)
    output = Path(output)
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    for filename, value in (("dataset.json", data), ("plan.json", plan), ("features.json", bundle),
                            ("model.json", model), ("report.json", report), ("public-trace.json", trace)):
        write_json(output / filename, value)
    return {"model_sha256": digest(model), "report_sha256": digest(report),
            "trace_head_sha256": trace["head_sha256"], "classification": data["classification"],
            "training_performed": True, "biological_core_weights_updated": False,
            "market_validation_established": False, "live_execution_allowed": False}


def verify(directory):
    directory = Path(directory)
    data, plan, bundle, saved_model, saved_report, saved_trace = [
        read_json(directory / filename) for filename in
        ("dataset.json", "plan.json", "features.json", "model.json", "report.json", "public-trace.json")]
    model, report = fit(data, plan, bundle)
    require(canonical(model) == canonical(saved_model) and canonical(report) == canonical(saved_report),
            "TRAINING_REPLAY_MISMATCH")
    require(canonical(public_trace(data, plan, bundle, model)) == canonical(saved_trace), "PUBLIC_TRACE_MISMATCH")
    return {"verified": True, "model_sha256": digest(model), "live_execution_allowed": False}


def demo_data():
    episodes = []
    for number in range(12):
        generator = random.Random(4100 + number)
        price = 1_000_000 + number * 113_000
        quotes = []
        direction = 1 if number % 2 == 0 else -1
        for step in range(16):
            move = direction * 9000 + generator.randint(-2000, 2000)
            if number % 4 == 2 and step == 11:
                move = -price // 3
            price = max(1000, price + move)
            moment = (number + 1) * 1_000_000 + step * 1000
            quotes.append({"event_ms": moment, "available_ms": moment + 20,
                           "bid": price - 10, "ask": price + 10,
                           "bid_size": 800_000 if direction > 0 else 200_000,
                           "ask_size": 200_000 if direction > 0 else 800_000})
        episodes.append({"episode_id": f"episode_{number:03}", "asset_group_sha256": digest(["synthetic", number]),
                         "quotes": quotes})
    data = {"protocol": "AAI_EPISODE_DATASET_V1", "classification": "SYNTHETIC_FIXTURE",
            "source": {"uri": "synthetic:trend-and-late-dump-software-fixture",
                       "content_sha256": digest(episodes), "rights": "DECLARED_PERMITTED"},
            "units": {"quote_unit": "micro_demo_usd", "base_scale": 1_000_000,
                      "price_unit": "QUOTE_UNITS_PER_WHOLE_BASE", "depth_unit": "BASE_ATOMS"},
            "episodes": episodes}
    plan = {"protocol": "AAI_READOUT_PLAN_V1", "dataset_sha256": digest(data), "horizon_ms": 1000,
            "shuffle_seed": 718, "alias_salt": digest("PUBLIC_SYNTHETIC_DEMO_ALIAS_SALT"),
            "splits": {"train": [e["episode_id"] for e in episodes[:8]],
                       "validation": [e["episode_id"] for e in episodes[8:10]],
                       "test": [e["episode_id"] for e in episodes[10:]]},
            "epochs": 200, "learning_rate": 0.1, "l2": 0.001}
    return data, plan
