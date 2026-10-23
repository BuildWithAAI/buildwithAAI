"""Run pinned Reef interfaces in an isolated interpreter; no model or network calls."""
from __future__ import annotations

from contextlib import closing
from pathlib import Path
import shutil
import socket
import sqlite3
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.ecosystem_research import learning, reef_adapter  # noqa: E402
from src.multi_brain_research import training_lab as lab  # noqa: E402
from src.solana_research import coin_evidence as ev  # noqa: E402


def deny_network(*_args, **_kwargs):
    raise RuntimeError("LEARNING_WORKER_NETWORK_BLOCKED")


def compute(source, eligible, pin):
    lab.require(source["classification"] in ("RPC_CAPTURE", "SYNTHETIC_ADAPTER_FIXTURE")
                and set(eligible) == set(learning.ROLES)
                and all(row["learning_eligible"] is True for row in eligible.values()), "LEARNING_ELIGIBILITY")
    curricula, proposals, results, releases, reviews, role_summary = {}, {}, {}, {}, {}, {}
    for role in learning.ROLES:
        curricula[role] = learning.curriculum(role, source["reports"][role])
        # The proposer has no holdout argument. Only the evaluator receives it.
        proposals[role] = learning.propose(role, curricula[role]["train"])
        results[role] = reef_adapter.select(curricula[role], proposals[role])
        baseline = learning.policy(role, ["protocol"])
        releases[role] = learning.release_chain(role, baseline, proposals[role], results[role])
        reviews[role] = learning.review(releases[role]["active_policy"], source["reports"][role])
        lab.require(reviews[role]["accepted"], "LEARNING_VERIFIED_SOURCE_REJECTED")
        role_summary[role] = {
            "policy_sha256": lab.digest(proposals[role]), "checks": len(proposals[role]["checks"]),
            "training_cases": len(curricula[role]["train"]), "holdout_cases": len(curricula[role]["holdout"]),
            "reference_balanced_accuracy_ppm": results[role]["baseline"]["metrics"]["balanced_accuracy_ppm"],
            "selected_balanced_accuracy_ppm": results[role]["proposal"]["evaluation"]["metrics"]["balanced_accuracy_ppm"],
            "regression_rejected": not results[role]["regression"]["selected"],
            "original_report_accepted": reviews[role]["accepted"], "active_scope": learning.SCOPE}
    summary = {"protocol": "AAI_REEF_LEARNING_SUMMARY_V1", "source_classification": source["classification"],
               "input_sha256": lab.digest(source), "reef_commit": pin["commit"], "roles": role_summary,
               "ecosystem_public_snapshot_sha256": source["files"]["public-snapshot.json"]["sha256"]
                    if source["classification"] == "RPC_CAPTURE" else None,
               "reef_records": 4, "eligible_feedback_records": 2, "consumption_receipts": 2,
               "selected_policies": 2, "rejected_regression_candidates": 2,
               "challenge_classification": "SYNTHETIC_CONTRACT_CHALLENGES",
               "proposer": "DETERMINISTIC_FINITE_RULE_INDUCTION", "learning_surface": learning.SCOPE,
               "model_inference_performed": False, "model_weights_updated": False,
               "market_performance_measured": False, "payments_performed": False, "live_execution_allowed": False}
    code = {name: ev.sha((ROOT / name).read_bytes()) for name in (
        "src/ecosystem_research/learning.py", "src/ecosystem_research/reef_adapter.py",
        "scripts/ecosystem_learning_worker.py")}
    return {"curricula.json": curricula, "proposals.json": proposals, "evaluation.json": results,
            "releases.json": releases, "reviews.json": reviews, "reef-records.json": eligible,
            "component.json": pin, "evaluator-code.json": code, "summary.json": summary,
            "public-snapshot.json": learning.public_projection(summary)}, proposals, curricula


def database_check(database):
    with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as connection:
        lab.require(connection.execute("SELECT COUNT(*) FROM agent_record").fetchone()[0] == 4,
                    "REEF_GLOBAL_RECORD_COUNT")


def main():
    phase, output, reef = sys.argv[1:]
    output, reef = Path(output).resolve(), Path(reef).resolve()
    lab.require(phase in ("build", "verify"), "LEARNING_WORKER_PHASE")
    socket.create_connection = deny_network
    socket.socket.connect = deny_network
    pin = reef_adapter.load_reef(reef)
    source = ev.read(output / "input.json")
    database = output / "state/reef.sqlite3"
    if phase == "build":
        eligible = reef_adapter.store_records(database, source, {}, {}, stage="ingest")
        expected, proposals, curricula = compute(source, eligible, pin)
        consumed = reef_adapter.store_records(database, source, proposals, curricula, stage="consume")
        lab.require(consumed == eligible, "REEF_ELIGIBILITY_CHANGED")
        for name, value in expected.items():
            ev.write(output / name, value)
    else:
        eligible = ev.read(output / "reef-records.json")
        expected, proposals, curricula = compute(source, eligible, pin)
        # Open a disposable database copy; verification never migrates the retained original.
        with tempfile.TemporaryDirectory() as directory:
            copy = Path(directory) / "reef.sqlite3"
            shutil.copyfile(database, copy)
            actual = reef_adapter.store_records(copy, source, proposals, curricula, stage="verify")
        lab.require(actual == eligible, "REEF_ELIGIBILITY_REPLAY")
        for name, value in expected.items():
            lab.require(ev.canonical(value) == ev.canonical(ev.read(output / name)), "LEARNING_REPLAY_CHANGED:" + name)
    database_check(database)
    reef_adapter.verify_reef(reef)
    print(ev.canonical({"verified": True, **expected["summary.json"]}), flush=True)


if __name__ == "__main__":
    main()
