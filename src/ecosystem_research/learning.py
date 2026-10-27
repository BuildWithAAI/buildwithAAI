"""Finite report-review learning; original source verifiers retain all authority."""
from __future__ import annotations

from copy import deepcopy

from ..multi_brain_research import training_lab as lab
from ..solana_research import coin_evidence as ev

ROLES = ("source_auditor", "forecast_reviewer")
SCOPE = "ADVISORY_REPORT_REVIEW"
PROTOCOLS = {role: "AAI_ECOSYSTEM_" + name + "_REPORT_V1"
             for role, name in zip(ROLES, ("SOURCE", "FORECAST"), strict=True)}
SOURCE_FILES = ("jobs.json", "source_auditor.json", "forecast_reviewer.json",
                "gate.json", "summary.json", "public-snapshot.json", "state/community.sqlite3")
CHECKS = ("protocol", "dataset_digest", "execution_disabled", "source_classification",
          "no_target_training", "no_market_claim", "transaction_units", "forecast_rows")


def is_digest(value):
    return type(value) is str and len(value) == 64 and all(c in "0123456789abcdef" for c in value)


def check_results(role, report):
    lab.require(role in ROLES and type(report) is dict, "LEARNING_REPORT_TYPE")
    assessment = report.get("assessment", {}) if role == ROLES[0] else report
    assessment = assessment if type(assessment) is dict else {}
    task = report.get("task", {})
    rows = report.get("rows")
    return {
        "protocol": report.get("protocol") == PROTOCOLS[role],
        "dataset_digest": is_digest(report.get("dataset_sha256")),
        "execution_disabled": report.get("live_execution_allowed") is False,
        "source_classification": assessment.get("classification") == "RPC_CAPTURE",
        "no_target_training": assessment.get("training_performed" if role == ROLES[0]
                                              else "training_on_target_performed") is False,
        "no_market_claim": assessment.get("market_validation_established") is False,
        "transaction_units": role == ROLES[0] or (type(task) is dict
                                and task.get("horizon_unit") == "LATER_MARKET_TRANSACTIONS"),
        "forecast_rows": role == ROLES[0] or (type(rows) is list and 1 <= len(rows) <= 2048
                          and all(type(row) is dict and row.get("action") == "NO_EXECUTION"
                                  and row.get("calibration") == "NOT_ESTABLISHED"
                                  and type(row.get("prediction_ppm")) is int
                                  and 0 <= row["prediction_ppm"] <= 1_000_000 for row in rows)),
    }


def policy(role, checks):
    value = {"protocol": "AAI_REPORT_REVIEW_POLICY_V1", "role": role, "scope": SCOPE,
             "checks": list(checks), "live_execution_allowed": False}
    validate_policy(value)
    return value


def validate_policy(value):
    lab.exact(value, ("protocol", "role", "scope", "checks", "live_execution_allowed"))
    lab.require(value["protocol"] == "AAI_REPORT_REVIEW_POLICY_V1" and value["role"] in ROLES
                and value["scope"] == SCOPE and value["live_execution_allowed"] is False,
                "LEARNING_POLICY_SCOPE")
    checks = value["checks"]
    lab.require(type(checks) is list and 1 <= len(checks) <= len(CHECKS)
                and all(type(item) is str and item in CHECKS for item in checks)
                and len(set(checks)) == len(checks), "LEARNING_POLICY_CHECKS")
    lab.require(checks == [item for item in CHECKS if item in checks], "LEARNING_POLICY_ORDER")
    return value


def review(value, report):
    validate_policy(value)
    results = check_results(value["role"], report)
    failed = [name for name in value["checks"] if not results[name]]
    return {"accepted": not failed, "failed_checks": failed,
            "policy_sha256": lab.digest(value), "report_sha256": lab.digest(report),
            "scope": SCOPE, "live_execution_allowed": False}


def source_snapshot(directory):
    """Call only after full ecosystem reconstruction, including community audit."""
    from pathlib import Path
    directory = Path(directory)
    files = {}
    for name in SOURCE_FILES:
        path = directory / name
        lab.require(path.is_file() and not path.is_symlink(), "LEARNING_SOURCE_FILE")
        size = path.stat().st_size
        lab.require(0 < size <= (16 * 1024**2 if name.endswith("sqlite3") else 256 * 1024),
                    "LEARNING_SOURCE_BOUND")
        raw = path.read_bytes()
        files[name] = {"sha256": ev.sha(raw), "bytes": len(raw)}
    jobs, summary = ev.read(directory / "jobs.json"), ev.read(directory / "summary.json")
    gate, public = ev.read(directory / "gate.json"), ev.read(directory / "public-snapshot.json")
    reports = {role: ev.read(directory / (role + ".json")) for role in ROLES}
    lab.require(set(jobs["jobs"]) == set(ROLES) and summary["source_classification"] == "RPC_CAPTURE"
                and summary["completed_jobs"] == 2 and summary["cross_agent_read_denied"] is True
                and summary["live_execution_allowed"] is False and summary["payments_performed"] is False
                and gate["action"] == "NO_EXECUTION" and gate["research_signal"] == "ABSTAIN"
                and gate["live_execution_allowed"] is False and public["live_execution_allowed"] is False
                and jobs["audit"]["audit_head"] == summary["audit_head"], "LEARNING_SOURCE_SCOPE")
    for role in ROLES:
        item = jobs["jobs"][role]
        report_file = files[role + ".json"]
        lab.require(item["state"] == "SUCCEEDED" and item["report_sha256"] == report_file["sha256"]
                    and item["report_bytes"] == report_file["bytes"]
                    and all(check_results(role, reports[role]).values()), "LEARNING_SOURCE_BINDING")
    lab.require(reports[ROLES[0]]["dataset_sha256"] == reports[ROLES[1]]["dataset_sha256"],
                "LEARNING_DATASET_BINDING")
    return {"protocol": "AAI_LEARNING_VERIFIED_INPUT_V1", "classification": "RPC_CAPTURE",
            "files": files, "jobs": jobs["jobs"], "audit_head": summary["audit_head"],
            "reports": reports, "verification": "SOURCE_RECONSTRUCTION_AND_COMMUNITY_AUDIT",
            "quality_target": "INTERNAL_REPORT_CONSISTENCY_ONLY", "live_execution_allowed": False}


def fixtures():
    """Small labeled fixtures for contract tests, never represented as source evidence."""
    return {
        ROLES[0]: {"protocol": PROTOCOLS[ROLES[0]], "dataset_sha256": "a" * 64,
                   "assessment": {"classification": "RPC_CAPTURE", "training_performed": False,
                                  "market_validation_established": False}, "live_execution_allowed": False},
        ROLES[1]: {"protocol": PROTOCOLS[ROLES[1]], "dataset_sha256": "a" * 64,
                   "classification": "RPC_CAPTURE", "training_on_target_performed": False,
                   "market_validation_established": False, "live_execution_allowed": False,
                   "task": {"horizon_unit": "LATER_MARKET_TRANSACTIONS"},
                   "rows": [{"prediction_ppm": 500000, "action": "NO_EXECUTION",
                             "calibration": "NOT_ESTABLISHED"}]},
    }


def curriculum(role, seed):
    """Synthetic corruptions; proposer receives training cases only, never holdout."""
    lab.require(all(check_results(role, seed).values()), "LEARNING_CURRICULUM_SEED")
    paths = [("protocol",), ("dataset_sha256",), ("live_execution_allowed",)]
    prefix = ("assessment",) if role == ROLES[0] else ()
    paths += [prefix + ("classification",), prefix + (("training_performed",) if role == ROLES[0]
                else ("training_on_target_performed",)), prefix + ("market_validation_established",)]
    if role == ROLES[1]:
        paths += [("task", "horizon_unit"), ("rows",)]
    wrong = ["WRONG_PROTOCOL", "not-a-digest", True, "SYNTHETIC_FIXTURE", True, True]
    if role == ROLES[1]:
        wrong += ["MILLISECONDS", []]
    training, holdout = [], []
    for split, cases, fill in (("train", training, "b"), ("holdout", holdout, "c")):
        good = deepcopy(seed)
        good["dataset_sha256"] = fill * 64
        cases.append({"id": split + ":valid", "report": good, "expected": True})
        for index, (path, bad_value) in enumerate(zip(paths, wrong, strict=True)):
            bad = deepcopy(good)
            node = bad
            for part in path[:-1]:
                node = node[part]
            if split == "train":
                node[path[-1]] = bad_value
            else:
                node.pop(path[-1])
            cases.append({"id": f"{split}:invalid:{index}", "report": bad, "expected": False})
        if split == "holdout":
            bad = deepcopy(good)
            bad["live_execution_allowed"] = 0  # False equality must not admit integers.
            bad["dataset_sha256"] = "d" * 63
            cases.append({"id": "holdout:compound", "report": bad, "expected": False})
    lab.require(not ({lab.digest(c["report"]) for c in training}
                     & {lab.digest(c["report"]) for c in holdout}), "LEARNING_SPLIT_OVERLAP")
    return {"protocol": "AAI_REVIEW_CHALLENGES_V1", "classification": "SYNTHETIC_CONTRACT_CHALLENGES",
            "role": role, "seed_sha256": lab.digest(seed), "train": training, "holdout": holdout,
            "market_performance_measured": False}


def propose(role, training):
    """Deterministic finite rule induction, without an LLM or model-weight update."""
    lab.require(type(training) is list and 2 <= len(training) <= 64, "LEARNING_TRAINING_BOUND")
    for case in training:
        lab.exact(case, ("id", "report", "expected"))
        lab.require(type(case["expected"]) is bool and case["id"].startswith("train:"),
                    "LEARNING_PROPOSER_SPLIT")
    positives = [c for c in training if c["expected"]]
    remaining = [c for c in training if not c["expected"]]
    lab.require(positives and remaining, "LEARNING_CLASS_COVERAGE")
    available = [name for name in CHECKS if all(check_results(role, c["report"])[name] for c in positives)]
    chosen = ["protocol"]
    remaining = [c for c in remaining if review(policy(role, chosen), c["report"])["accepted"]]
    while remaining:
        gains = {name: sum(not check_results(role, c["report"])[name] for c in remaining)
                 for name in available if name not in chosen}
        lab.require(gains and max(gains.values()) > 0, "LEARNING_NO_QUALIFIED_PROPOSAL")
        chosen.append(max(gains, key=gains.get))
        remaining = [c for c in remaining if check_results(role, c["report"])[chosen[-1]]]
    return policy(role, [name for name in CHECKS if name in chosen])


def evaluate(value, cases):
    lab.require(type(cases) is list and 2 <= len(cases) <= 64, "LEARNING_EVALUATION_BOUND")
    positive = negative = false_accepts = false_rejects = 0
    for case in cases:
        lab.require(type(case["expected"]) is bool, "LEARNING_EVALUATION_LABEL")
        accepted = review(value, case["report"])["accepted"]
        positive += case["expected"]
        negative += not case["expected"]
        false_accepts += accepted and not case["expected"]
        false_rejects += not accepted and case["expected"]
    lab.require(positive and negative, "LEARNING_EVALUATION_CLASSES")
    accuracy = round(((positive - false_rejects) / positive
                      + (negative - false_accepts) / negative) * 500_000)
    return {"balanced_accuracy_ppm": accuracy, "false_accepts": false_accepts,
            "false_rejects": false_rejects, "examples": len(cases), "checks": len(value["checks"])}


def release_chain(role, baseline, proposed, decisions):
    lab.require(decisions["proposal"]["selected"] is True
                and decisions["regression"]["selected"] is False, "LEARNING_SELECTION_REQUIRED")
    entries, previous = [], "0" * 64
    for event, value in (("REFERENCE_ONLY", baseline), ("SELECTED_ADVISORY", proposed),
                         ("REJECTED_REGRESSION", baseline)):
        item = {"sequence": len(entries), "role": role, "event": event,
                "policy_sha256": lab.digest(value), "previous_sha256": previous,
                "active_policy_sha256": lab.digest(proposed) if entries else None}
        previous = lab.digest(item)
        entries.append({**item, "sha256": previous})
    return {"protocol": "AAI_ADVISORY_RELEASE_CHAIN_V1", "entries": entries, "head_sha256": previous,
            "active_policy": proposed, "scope": SCOPE, "live_execution_allowed": False}


def public_projection(summary):
    fields = ("policy_sha256", "checks", "training_cases", "holdout_cases",
              "reference_balanced_accuracy_ppm", "selected_balanced_accuracy_ppm",
              "regression_rejected", "original_report_accepted", "active_scope")
    return {"protocol": "AAI_LEARNING_PUBLIC_SNAPSHOT_V1", "mode": SCOPE,
            "ecosystem_public_snapshot_sha256": summary["ecosystem_public_snapshot_sha256"],
            "upstream_research_signal": "ABSTAIN", "original_source_verification_required": True,
            "source_classification": summary["source_classification"],
            "completed_source_jobs": 2, "reef_records": 4, "selected_policies": 2,
            "roles": {role: {key: summary["roles"][role][key] for key in fields} for role in ROLES},
            "challenge_classification": "SYNTHETIC_CONTRACT_CHALLENGES",
            "model_weights_updated": False, "trading_qualification_established": False,
            "payments_performed": False, "live_execution_allowed": False}
