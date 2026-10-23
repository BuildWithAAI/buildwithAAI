"""Actual pinned Reef record storage and candidate selection, without a model server."""
from __future__ import annotations

from dataclasses import replace
from importlib.metadata import version
import os
from pathlib import Path
import subprocess
import sys

from ..multi_brain_research import training_lab as lab
from ..solana_research import coin_evidence as ev
from . import learning

ROOT = Path(__file__).resolve().parents[2]
REEF_COMMIT = "b8809cdcec899c7603708f6eaeddbb4955070043"


def verify_reef(path):
    path = Path(path).resolve()
    pin = ev.read(ROOT / "research/ecosystem/reef.json")
    lab.require(pin["repository"] == "Human-Agent-Society/reef" and pin["commit"] == REEF_COMMIT,
                "REEF_PIN_CHANGED")
    head = subprocess.check_output(["git", "-C", str(path), "rev-parse", "HEAD"],
                                   text=True, timeout=20).strip()
    changed = subprocess.check_output(["git", "-C", str(path), "diff", "--no-ext-diff", "HEAD", "--"],
                                      timeout=20)
    untracked = subprocess.check_output(["git", "-C", str(path), "ls-files", "--others"], timeout=20)
    lab.require(head == REEF_COMMIT and not changed and not untracked, "REEF_CHECKOUT_CHANGED")
    return pin


def load_reef(path):
    # This pin imports the Unix resource module through reef.sandbox.process.
    lab.require(os.name == "posix", "REEF_POSIX_RUNTIME_REQUIRED")
    pin = verify_reef(path)
    lab.require(sys.version_info >= (3, 12), "REEF_PYTHON_312_REQUIRED")
    from packaging.requirements import Requirement
    runtime = {}
    locked = ROOT / "experiments/ecosystem_learning/requirements.lock"
    for line in locked.read_text(encoding="utf-8").splitlines():
        if line and not line.startswith(("#", " ", "-")):
            requirement = Requirement(line.removesuffix("\\").strip())
            if requirement.marker is None or requirement.marker.evaluate():
                installed = version(requirement.name)
                lab.require(installed in requirement.specifier, "REEF_RUNTIME_VERSION_MISMATCH:" + requirement.name)
                runtime[requirement.name] = installed
    sys.path.insert(0, str(Path(path).resolve()))
    import reef
    lab.require(Path(reef.__file__).resolve() == Path(path).resolve() / "reef/__init__.py",
                "REEF_IMPORT_SOURCE_MISMATCH")
    return {**pin, "runtime_versions": runtime, "runtime_lock_sha256": ev.sha(locked.read_bytes())}


def select(curriculum, proposed):
    from reef.core.evaluation import EvaluationResult, SelectionDecision, UpdateCandidate
    from reef.evaluation import RegressionCheckMixin

    baseline = learning.policy(curriculum["role"], ["protocol"])

    class ReviewSelection(RegressionCheckMixin):
        def __init__(self):
            super().__init__(metric="balanced_accuracy_ppm", margin=0)
            self.baseline_score = learning.evaluate(baseline, curriculum["holdout"])["balanced_accuracy_ppm"]

        def evaluate(self, candidate):
            value = candidate.metadata["policy"]
            learning.validate_policy(value)
            lab.require(candidate.candidate_id == lab.digest(value)
                        and value["role"] == curriculum["role"], "REEF_CANDIDATE_BINDING")
            return EvaluationResult("aai-report-contracts", "1",
                                    learning.evaluate(value, curriculum["holdout"]),
                                    {"holdout_sha256": lab.digest(curriculum["holdout"]),
                                     "classification": curriculum["classification"],
                                     "policy_sha256": candidate.candidate_id})

        def decide(self, candidate, evaluation):
            lab.require(evaluation.to_dict() == self.evaluate(candidate).to_dict(), "REEF_EVALUATION_CHANGED")
            metrics = evaluation.metrics
            qualifies = (metrics["balanced_accuracy_ppm"] > self.baseline_score
                         and metrics["false_accepts"] == 0 and metrics["false_rejects"] == 0)
            if not qualifies:
                return SelectionDecision(False, "aai-strict-review",
                                         "candidate must improve the reference and pass every contract challenge",
                                         evaluation)
            result = super().decide(candidate, evaluation)
            return SelectionDecision(result.selected, "aai-strict-review", result.reason, evaluation)

    selector = ReviewSelection()
    old = UpdateCandidate(lab.digest(baseline), {"policy": baseline})
    # Seed Reef's best-checkpoint memory; this reference is never an active release.
    RegressionCheckMixin.decide(selector, old, selector.evaluate(old))
    candidate = UpdateCandidate(lab.digest(proposed), {"policy": proposed})
    accepted = selector.decide(candidate, selector.evaluate(candidate)).to_dict()
    rejected = selector.decide(old, selector.evaluate(old)).to_dict()
    return {"baseline": selector.evaluate(old).to_dict(), "proposal": accepted, "regression": rejected}


def records_for(source):
    from reef.core import AgentRecord, RequestType
    from reef.core.reports import ScoredRolloutReport

    result = {}
    for role in learning.ROLES:
        item = source["jobs"][role]
        receipt = lab.digest([source["audit_head"], role, item["job_id"], item["report_sha256"]])
        scenario = "aai-review-" + role
        # Both records are REPORTs. No model inference is fabricated for Python jobs.
        job = AgentRecord.create(agent_record_id=receipt, scenario=scenario, request_type=RequestType.REPORT,
                                 payload={"metadata": {"kind": "EXTERNAL_PYTHON_JOB_ARTIFACT",
                                          "classification": source["classification"], "role": role,
                                          "job_id": item["job_id"], "artifact_id": item["artifact_id"],
                                          "report_sha256": item["report_sha256"],
                                          "report_bytes": item["report_bytes"],
                                          "audit_head": source["audit_head"], "model_inference_performed": False}})
        payload = ScoredRolloutReport(score=1.0).to_dict(references=[receipt])
        payload["metadata"] = {"quality_target": "INTERNAL_REPORT_CONSISTENCY_ONLY",
                               "verification": source["verification"], "role": role,
                               "learning_surface": learning.SCOPE, "market_performance_measured": False}
        feedback = AgentRecord.create(agent_record_id=lab.digest([receipt, "verified-report-review-v1"]),
                                      scenario=scenario, request_type=RequestType.REPORT, payload=payload)
        result[role] = (job, feedback)
    return result


def store_records(database, source, proposals, curricula, *, stage):
    from reef.storage.records import RecordConflict
    from reef.storage.sqlite import SQLiteRecordStore

    records = records_for(source)
    with SQLiteRecordStore(database) as store:
        for role, (job, feedback) in records.items():
            if stage == "ingest":
                first = store.append_many((job, feedback))
                lab.require(all(item.inserted for item in first), "REEF_RECORDS_NOT_NEW")
                retry = store.append_many((job, feedback))
                lab.require(not any(item.inserted for item in retry), "REEF_RETRY_DUPLICATED")
                altered = replace(feedback, payload={**feedback.payload, "score": 0.0})
                try:
                    store.append(altered)
                except RecordConflict:
                    pass
                else:
                    raise ValueError("REEF_CONFLICT_ACCEPTED")
            if stage == "consume":
                store.record_consumption(job.scenario, frozenset((job.agent_record_id, feedback.agent_record_id)),
                                         receipt_id=lab.digest([job.agent_record_id, "review-candidate"]),
                                         metadata={"policy_sha256": lab.digest(proposals[role]),
                                                   "training_sha256": lab.digest(curricula[role]["train"]),
                                                   "scope": learning.SCOPE})
            saved = store.replay(job.scenario)
            lab.require(len(saved) == 2 and store.count(job.scenario) == 2, "REEF_RECORD_COUNT")
            for actual, expected in zip(saved, (job, feedback), strict=True):
                lab.require(actual.agent_record_id == expected.agent_record_id
                            and actual.request_type == expected.request_type
                            and actual.scenario == expected.scenario and actual.references == expected.references
                            and actual.payload == expected.payload, "REEF_RECORD_REPLAY")
            other_role = next(name for name in learning.ROLES if name != role)
            lab.require(store.get("aai-review-" + other_role, job.agent_record_id) is None,
                        "REEF_SCENARIO_ISOLATION")
            receipts = store.consumption_receipts(job.scenario)
            if stage == "ingest":
                lab.require(not receipts, "REEF_PREMATURE_CONSUMPTION")
                continue
            lab.require(len(receipts) == 1 and set(receipts[0]["consumed_ids"]) == {
                        job.agent_record_id, feedback.agent_record_id}
                        and receipts[0]["metadata"] == {"policy_sha256": lab.digest(proposals[role]),
                            "training_sha256": lab.digest(curricula[role]["train"]), "scope": learning.SCOPE},
                        "REEF_CONSUMPTION_BINDING")
    # SQLiteRecordStore must have flushed its journal before the package is retained.
    lab.require(not Path(str(database) + "-wal").exists(), "REEF_OPEN_WAL")
    return {role: {"job_record_id": values[0].agent_record_id, "feedback_record_id": values[1].agent_record_id,
                   "learning_eligible": True, "quality_target": "INTERNAL_REPORT_CONSISTENCY_ONLY"}
            for role, values in records.items()}
