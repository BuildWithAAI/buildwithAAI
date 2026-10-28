"""Delayed outcomes, bounded pattern memory and advisory capability qualification."""
from __future__ import annotations

from collections import Counter
from copy import deepcopy

from ..multi_brain_research import training_lab as lab
from ..multi_brain_research import trade_learning as trade

DOMAINS = ("paper_trading", "contract_review", "code_review", "opsec_review")
WIDTH = {"paper_trading": 4, "contract_review": 8, "code_review": 5, "opsec_review": 8}
SCOPE = "SANDBOX_BEHAVIOR_ADVISORY"
MAX_CASES = 1024


def validate_cases(domain, cases):
    lab.require(domain in DOMAINS and type(cases) is list and 1 <= len(cases) <= MAX_CASES,
                "BEHAVIOR_CASE_BOUND")
    ids, digests, groups = set(), set(), {"train": set(), "holdout": set()}
    for case in cases:
        lab.exact(case, ("id", "domain", "classification", "split", "group", "observed_at", "resolved_at",
                         "features", "target", "source_sha256", "outcome_sha256", "oracle"))
        lab.require(case["domain"] == domain and case["classification"] == "SYNTHETIC_BEHAVIOR_TASK"
                    and case["split"] in groups and type(case["id"]) is str and len(case["id"]) <= 80
                    and case["id"] not in ids, "BEHAVIOR_CASE_IDENTITY")
        features = case["features"]
        lab.require(type(features) is list and len(features) == WIDTH[domain]
                    and all(type(x) is int and x in (-1, 0, 1) for x in features), "BEHAVIOR_FEATURES")
        for key in ("source_sha256", "outcome_sha256"):
            value = case[key]
            lab.require(type(value) is str and len(value) == 64
                        and all(c in "0123456789abcdef" for c in value), "BEHAVIOR_EVIDENCE_DIGEST")
        lab.require(type(case["observed_at"]) is int and type(case["resolved_at"]) is int
                    and 0 <= case["observed_at"] < case["resolved_at"] <= 10**9
                    and type(case["target"]) is int and case["target"] in (0, 1)
                    and type(case["group"]) is str and 1 <= len(case["group"]) <= 80
                    and type(case["oracle"]) is str and 1 <= len(case["oracle"]) <= 100,
                    "BEHAVIOR_OUTCOME_SCOPE")
        lab.require(case["source_sha256"] not in digests, "BEHAVIOR_DUPLICATE_SOURCE")
        ids.add(case["id"])
        digests.add(case["source_sha256"])
        groups[case["split"]].add(case["group"])
    lab.require(not (groups["train"] & groups["holdout"]), "BEHAVIOR_GROUP_LEAKAGE")
    training = [c for c in cases if c["split"] == "train"]
    holdout = [c for c in cases if c["split"] == "holdout"]
    if training and holdout:
        lab.require(max(c["resolved_at"] for c in training) < min(c["observed_at"] for c in holdout),
                    "BEHAVIOR_TEMPORAL_LEAKAGE")
    return cases


def fit(domain, training, cutoff):
    lab.require(domain in DOMAINS, "BEHAVIOR_DOMAIN")
    lab.require(type(cutoff) is int and 0 <= cutoff <= 10**9, "BEHAVIOR_TRAINING_CUTOFF")
    lab.require(type(training) is list and len(training) <= MAX_CASES, "BEHAVIOR_TRAINING_BOUND")
    if training:
        validate_cases(domain, training)
    lab.require(all(c["split"] == "train" and c["resolved_at"] <= cutoff for c in training),
                "BEHAVIOR_FUTURE_FEEDBACK")
    contexts = {}
    for case in training:
        key = lab.digest(case["features"])
        row = contexts.setdefault(key, {"features": case["features"], "zero": 0, "one": 0})
        row["one" if case["target"] else "zero"] += 1
    lab.require(len(contexts) <= 256, "BEHAVIOR_MEMORY_BOUND")
    return {"protocol": "AAI_BEHAVIOR_MEMORY_V1", "domain": domain, "scope": SCOPE,
            "contexts": dict(sorted(contexts.items())), "training_examples": len(training),
            "training_sha256": lab.digest(training), "cutoff": cutoff,
            "confidence": "EMPIRICAL_COUNTS_NOT_CALIBRATED", "live_execution_allowed": False}


def validate_model(value):
    lab.exact(value, ("protocol", "domain", "scope", "contexts", "training_examples", "training_sha256",
                      "cutoff", "confidence", "live_execution_allowed"))
    lab.require(value["protocol"] == "AAI_BEHAVIOR_MEMORY_V1" and value["domain"] in DOMAINS
                and value["scope"] == SCOPE and value["live_execution_allowed"] is False
                and value["confidence"] == "EMPIRICAL_COUNTS_NOT_CALIBRATED", "BEHAVIOR_MODEL_SCOPE")
    lab.require(type(value["contexts"]) is dict and len(value["contexts"]) <= 256, "BEHAVIOR_MODEL_BOUND")
    total = 0
    for key, row in value["contexts"].items():
        lab.exact(row, ("features", "zero", "one"))
        lab.require(type(row["features"]) is list and len(row["features"]) == WIDTH[value["domain"]]
                    and all(type(x) is int and x in (-1, 0, 1) for x in row["features"])
                    and key == lab.digest(row["features"]), "BEHAVIOR_CONTEXT_BINDING")
        lab.require(type(row["zero"]) is int and type(row["one"]) is int
                    and 0 <= row["zero"] <= MAX_CASES and 0 <= row["one"] <= MAX_CASES
                    and 1 <= row["zero"] + row["one"] <= MAX_CASES, "BEHAVIOR_COUNTS")
        total += row["zero"] + row["one"]
    lab.require(type(value["training_examples"]) is int and value["training_examples"] == total
                and total <= MAX_CASES, "BEHAVIOR_TRAINING_COUNT")
    lab.require(type(value["cutoff"]) is int and 0 <= value["cutoff"] <= 10**9
                and type(value["training_sha256"]) is str and len(value["training_sha256"]) == 64
                and all(c in "0123456789abcdef" for c in value["training_sha256"]), "BEHAVIOR_MODEL_PROVENANCE")
    return value


def predict(model, features):
    validate_model(model)
    lab.require(type(features) is list and len(features) == WIDTH[model["domain"]]
                and all(type(x) is int and x in (-1, 0, 1) for x in features), "BEHAVIOR_PREDICTION_INPUT")
    row = model["contexts"].get(lab.digest(features))
    support = 0 if row is None else row["zero"] + row["one"]
    probability = None if row is None else (row["one"] + 1) * 1_000_000 // (support + 2)
    decision = None
    if support >= 3 and (probability >= 666_667 or probability <= 333_333):
        decision = int(probability >= 666_667)
    return {"prediction": decision, "probability_ppm": probability, "support": support,
            "action": "ABSTAIN" if decision is None else "ADVISORY_CLASSIFICATION",
            "live_execution_allowed": False}


def measure(domain, predictions, holdout):
    lab.require(len(predictions) == len(holdout) and len(holdout) <= MAX_CASES, "BEHAVIOR_METRIC_BOUND")
    classes = Counter(c["target"] for c in holdout)
    correct, decided = Counter(), 0
    critical_errors = 0
    for decision, case in zip(predictions, holdout, strict=True):
        lab.require(decision is None or (type(decision) is int and decision in (0, 1)), "BEHAVIOR_DECISION_TYPE")
        decided += decision is not None
        correct[case["target"]] += decision == case["target"]
        if decision is not None and decision != case["target"]:
            critical_errors += decision == (0 if domain == "code_review" else 1)
    score = round(sum(correct[c] / classes[c] if classes[c] else 0 for c in (0, 1)) * 500_000)
    return {"examples": len(holdout), "zero_examples": classes[0], "one_examples": classes[1],
            "decisions": decided, "abstentions": len(holdout) - decided,
            "coverage_ppm": decided * 1_000_000 // len(holdout) if holdout else 0,
            "balanced_accuracy_ppm": score, "critical_errors": critical_errors,
            "abstentions_count_as_incorrect": True}


def evaluate(model, cases):
    validate_model(model)
    domain = model["domain"]
    validate_cases(domain, cases)
    train = [c for c in cases if c["split"] == "train"]
    holdout = [c for c in cases if c["split"] == "holdout"]
    lab.require(model["training_sha256"] == lab.digest(train), "BEHAVIOR_MODEL_TRAINING_BINDING")
    lab.require(all(c["resolved_at"] <= model["cutoff"] for c in train)
                and all(model["cutoff"] < c["observed_at"] for c in holdout), "BEHAVIOR_EVALUATION_CUTOFF")
    decisions = [predict(model, c["features"])["prediction"] for c in holdout]
    majority = int(sum(c["target"] for c in train) * 2 > len(train))
    candidate = measure(domain, decisions, holdout)
    baseline = measure(domain, [majority] * len(holdout), holdout)
    reasons = []
    for failed, name in ((len(train) < 32, "TRAINING_COHORT_TOO_SMALL"),
                         (len(holdout) < 16, "HOLDOUT_COHORT_TOO_SMALL"),
                         (min(candidate["zero_examples"], candidate["one_examples"]) < 4, "HOLDOUT_CLASS_SUPPORT"),
                         (candidate["coverage_ppm"] < 750_000, "COVERAGE_TOO_LOW"),
                         (candidate["balanced_accuracy_ppm"] < 750_000, "ACCURACY_TOO_LOW"),
                         (candidate["balanced_accuracy_ppm"] < baseline["balanced_accuracy_ppm"] + 50_000,
                          "NO_MEASURED_BASELINE_IMPROVEMENT"),
                         (candidate["critical_errors"] > 0, "CRITICAL_ADVISORY_ERRORS")):
        if failed:
            reasons.append(name)
    return {"protocol": "AAI_BEHAVIOR_EVALUATION_V1", "domain": domain, "candidate": candidate,
            "baseline": baseline, "baseline_method": "TRAINING_MAJORITY_CLASS",
            "holdout_sha256": lab.digest(holdout), "model_sha256": lab.digest(model),
            "eligible": not reasons, "reasons": reasons, "scope": SCOPE, "live_execution_allowed": False}


def prequential(domain, cases):
    """Predict first; only outcomes revealed by the current simulation clock can update memory."""
    validate_cases(domain, cases)
    queue, observed, known, events = [], set(), [], []
    model = fit(domain, [], 0)
    ordered = sorted(cases, key=lambda c: (c["observed_at"], c["id"]))
    for case in ordered:
        due = sorted((c for c in queue if c["resolved_at"] <= case["observed_at"]),
                     key=lambda c: (c["resolved_at"], c["id"]))
        for resolved in due:
            lab.require(resolved["id"] in observed, "BEHAVIOR_UNOBSERVED_FEEDBACK")
            events.append({"type": "OUTCOME", "case_id": resolved["id"], "at": resolved["resolved_at"],
                           "target": resolved["target"], "evidence_sha256": resolved["outcome_sha256"]})
            if resolved["split"] == "train":
                known.append(resolved)
            queue.remove(resolved)
        model = fit(domain, known, case["observed_at"])
        result = predict(model, case["features"])
        events.append({"type": "DECISION", "case_id": case["id"], "at": case["observed_at"],
                       "features": case["features"], "memory_sha256": lab.digest(model), **result})
        observed.add(case["id"])
        queue.append(case)
    for resolved in sorted(queue, key=lambda c: (c["resolved_at"], c["id"])):
        events.append({"type": "OUTCOME", "case_id": resolved["id"], "at": resolved["resolved_at"],
                       "target": resolved["target"], "evidence_sha256": resolved["outcome_sha256"]})
    linked, previous = [], "0" * 64
    for sequence, event in enumerate(events):
        row = {"sequence": sequence, "previous_sha256": previous, "event": event}
        previous = lab.digest(row)
        linked.append({**row, "sha256": previous})
    return {"protocol": "AAI_BEHAVIOR_REPLAY_V1", "clock": "SYNTHETIC_SIMULATION_SEQUENCE",
            "domain": domain, "classification": "SYNTHETIC_BEHAVIOR_TASK", "events": linked,
            "head_sha256": previous, "holdout_updates_allowed": False, "live_execution_allowed": False}


def domain_report(domain, cases):
    validate_cases(domain, cases)
    training = [c for c in cases if c["split"] == "train"]
    holdout = [c for c in cases if c["split"] == "holdout"]
    lab.require(training and holdout, "BEHAVIOR_PARTITIONS_REQUIRED")
    cutoff = min(c["observed_at"] for c in holdout) - 1
    model = fit(domain, training, cutoff)
    result = evaluate(model, cases)
    flipped = deepcopy(model)
    for row in flipped["contexts"].values():
        row["zero"], row["one"] = row["one"], row["zero"]
    regression = evaluate(flipped, cases)
    return {"protocol": "AAI_BEHAVIOR_DOMAIN_REPORT_V1", "domain": domain, "model": model,
            "evaluation": result, "regression_probe": regression, "cases_sha256": lab.digest(cases),
            "actual_execution_authorized": False, "scope": SCOPE, "live_execution_allowed": False}


def recorded_trade_feedback(data, forecast, plan):
    episodes = trade.validate_dataset(data)
    lab.integer(plan["horizon_transactions"], 1, 64)
    lab.integer(plan["max_horizon_slots"], 1, 4096)
    lab.require(forecast["dataset_sha256"] == lab.digest(data) and forecast["live_execution_allowed"] is False
                and forecast["task"]["horizon_unit"] == "LATER_MARKET_TRANSACTIONS"
                and forecast["task"]["count"] == plan["horizon_transactions"]
                and forecast["task"]["max_horizon_slots"] == plan["max_horizon_slots"], "BEHAVIOR_RECORDED_TASK")
    rows = {(r["episode_id"], r["sequence"]): r for r in forecast["rows"]}
    lab.require(len(rows) == len(forecast["rows"]), "BEHAVIOR_DUPLICATE_FORECAST")
    expected_keys = {(e["episode_id"], i) for e in episodes.values() for i in range(len(e["observations"]))}
    lab.require(set(rows) == expected_keys, "BEHAVIOR_FORECAST_COVERAGE")
    evidence, brier, correct, resolved = [], 0, 0, 0
    for episode in episodes.values():
        observations = episode["observations"]
        for index, current in enumerate(observations):
            key = (episode["episode_id"], index)
            row = rows[key]
            probability = row["prediction_ppm"]
            lab.require(type(probability) is int and 0 <= probability <= 1_000_000
                        and row["order"] == current["order"] and row["action"] == "NO_EXECUTION",
                        "BEHAVIOR_FORECAST_ROW")
            target_index = index + plan["horizon_transactions"]
            available = target_index < len(observations) and (observations[target_index]["order"][0]
                        - current["order"][0] <= plan["max_horizon_slots"])
            label, outcome_order = None, None
            if available:
                target = observations[target_index]
                outcome_order = target["order"]
                lab.require(tuple(outcome_order) > tuple(current["order"]), "BEHAVIOR_LEDGER_ORDER")
                label = int(trade.quoted_price(target) > trade.quoted_price(current))
                brier += (probability - label * 1_000_000)**2
                correct += int(probability >= 500_000) == label
                resolved += 1
            evidence.append({"case_id": lab.digest([data["classification"], key]),
                             "asset_group_sha256": episode["asset_group_sha256"],
                             "observed_order": current["order"], "outcome_order": outcome_order,
                             "causal_pattern": [0 if abs(x) < 0.05 else (1 if x > 0 else -1)
                                                for x in trade.features(episode, index)],
                             "prediction_ppm": probability, "target": label,
                             "outcome_status": "RESOLVED" if available else "PENDING_UNLABELED",
                             "source_sha256": lab.digest(current), "action": "NO_EXECUTION"})
    return {"protocol": "AAI_RECORDED_BEHAVIOR_FEEDBACK_V1", "classification": data["classification"],
            "task": forecast["task"], "dataset_sha256": lab.digest(data), "model_sha256": forecast["model_sha256"],
            "rows": evidence, "observations": len(evidence), "resolved_outcomes": resolved,
            "pending_outcomes": len(evidence) - resolved,
            "direction_accuracy_ppm": correct * 1_000_000 // resolved if resolved else None,
            "brier_ppm": brier // (resolved * 1_000_000) if resolved else None,
            "weight_training_performed": False, "patterns": "CAUSAL_TRADE_FEATURE_BINS",
            "feedback_use": "RETAINED_FOR_RESEARCH_NOT_AUTO_PROMOTION",
            "real_market_qualification": "BLOCKED_REPRESENTATIVE_CORPUS_AND_CALIBRATION_REQUIRED",
            "profit_or_executable_return_measured": False, "live_observer_latency_known": False,
            "live_execution_allowed": False}
