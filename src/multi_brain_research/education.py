"""Versioned public practice and research-lab admission. Never a trading licence.

Answer keys are public. Grades attest only to these submitted responses, not
model training, understanding, identity, market skill or independent evaluation.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import urlsplit

from .contracts import ContractError, Snapshot, _name, _pin, _time
from .graph import canonical

CURRICULUM = Path(__file__).resolve().parents[2] / "research/trading-school/curriculum.json"
DAY_MS = 86_400_000
LIVE_BLOCKERS = ("NO_INDEPENDENT_HELD_OUT_EVALUATION", "NO_ATTESTED_FORWARD_PAPER_RECORD",
                 "NO_REVIEWED_EXECUTION_ADAPTER", "NO_SEPARATE_LIVE_AUTHORIZATION")


def require(condition, reason):
    if not condition:
        raise ContractError(reason)


def digest(domain, value):
    return hashlib.sha256(domain.encode("ascii") + b"\0" + canonical(value)).hexdigest()


def exact_fields(value, fields):
    require(type(value) is dict and set(value) == set(fields), "INVALID_FIELDS")


def _pairs(items):
    result = {}
    for key, value in items:
        require(key not in result, "DUPLICATE_JSON_KEY")
        result[key] = value
    return result


def parse_json(raw):
    require(type(raw) is bytes and 0 < len(raw) <= 1_048_576, "INVALID_INPUT_SIZE")
    try:
        return json.loads(raw, object_pairs_hook=_pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(ContractError("NONFINITE_JSON")))
    except ContractError:
        raise
    except (UnicodeError, ValueError, RecursionError):
        raise ContractError("INVALID_JSON") from None


@dataclass(frozen=True)
class Curriculum:
    encoded: bytes

    def __post_init__(self):
        data = parse_json(self.encoded)
        exact_fields(data, ("schema_version", "curriculum_id", "reviewed_at_ms", "review_valid_until_ms",
                            "minimum_score_ppm", "assessment_scope", "sources", "lessons", "tracks", "cases"))
        require(type(data["schema_version"]) is int and data["schema_version"] == 1
                and data["assessment_scope"] == "PUBLIC_PRACTICE_ONLY", "UNSUPPORTED_CURRICULUM")
        _name(data["curriculum_id"])
        for key in ("reviewed_at_ms", "review_valid_until_ms"):
            _time(data[key])
        require(data["reviewed_at_ms"] < data["review_valid_until_ms"], "INVALID_REVIEW_WINDOW")
        require(type(data["minimum_score_ppm"]) is int and 1 <= data["minimum_score_ppm"] <= 1_000_000,
                "INVALID_PRACTICE_THRESHOLD")
        collections = {}
        for key, id_key, bound in (("sources", "source_id", 64), ("lessons", "lesson_id", 128),
                                   ("tracks", "track_id", 16), ("cases", "case_id", 512)):
            rows = data[key]
            require(type(rows) is list and 1 <= len(rows) <= bound, "INVALID_CURRICULUM_BOUND")
            require(all(type(row) is dict and id_key in row for row in rows), "INVALID_CURRICULUM_ROW")
            for row in rows:
                _name(row[id_key])
            require(len({row[id_key] for row in rows}) == len(rows), "DUPLICATE_CURRICULUM_ID")
            collections[key] = {row[id_key]: row for row in rows}
        for row in data["sources"]:
            exact_fields(row, ("source_id", "url", "publisher", "review_note"))
            require(all(type(row[key]) is str and 1 <= len(row[key]) <= 1024
                        for key in ("url", "publisher", "review_note")), "INVALID_SOURCE")
            url = urlsplit(row["url"])
            require(url.scheme == "https" and bool(url.hostname) and url.username is None
                    and url.password is None and not url.fragment, "INVALID_SOURCE_URL")
        for row in data["lessons"]:
            exact_fields(row, ("lesson_id", "title", "study_notes", "objectives", "sources"))
            require(all(type(row[key]) is str and 1 <= len(row[key]) <= 4096 for key in ("title", "study_notes")),
                    "INVALID_LESSON")
            require(type(row["objectives"]) is list and 1 <= len(row["objectives"]) <= 16
                    and all(type(item) is str and 1 <= len(item) <= 512 for item in row["objectives"]), "INVALID_OBJECTIVES")
            require(type(row["sources"]) is list and bool(row["sources"])
                    and all(type(item) is str and item in collections["sources"] for item in row["sources"]),
                    "UNKNOWN_LESSON_SOURCE")
        for row in data["cases"]:
            exact_fields(row, ("case_id", "lesson_id", "prompt", "choices", "expected", "safety_critical"))
            require(type(row["lesson_id"]) is str and row["lesson_id"] in collections["lessons"], "UNKNOWN_CASE_LESSON")
            require(type(row["prompt"]) is str and 1 <= len(row["prompt"]) <= 2048, "INVALID_PROMPT")
            require(type(row["choices"]) is list and 2 <= len(row["choices"]) <= 8
                    and all(type(choice) is str and 1 <= len(choice) <= 128 for choice in row["choices"]), "INVALID_CHOICES")
            require(len(set(row["choices"])) == len(row["choices"]) and type(row["expected"]) is str
                    and row["expected"] in row["choices"] and type(row["safety_critical"]) is bool, "INVALID_ANSWER_KEY")
        for row in data["tracks"]:
            exact_fields(row, ("track_id", "title", "lessons", "paper_lab_blockers"))
            require(type(row["title"]) is str and 1 <= len(row["title"]) <= 128, "INVALID_TRACK_TITLE")
            require(type(row["lessons"]) is list and 1 <= len(row["lessons"]) <= 128
                    and all(type(item) is str and item in collections["lessons"] for item in row["lessons"]),
                    "UNKNOWN_TRACK_LESSON")
            require(len(set(row["lessons"])) == len(row["lessons"]), "DUPLICATE_TRACK_LESSON")
            require(type(row["paper_lab_blockers"]) is list and len(row["paper_lab_blockers"]) <= 16
                    and all(type(item) is str and 1 <= len(item) <= 128 for item in row["paper_lab_blockers"]),
                    "INVALID_TRACK_BLOCKERS")
            require(all(any(case["lesson_id"] == lesson for case in data["cases"]) for lesson in row["lessons"]),
                    "UNASSESSED_LESSON")
        # Freeze the logical content, independent of formatting or external dictionaries.
        object.__setattr__(self, "encoded", canonical(data))

    @classmethod
    def load(cls, path=CURRICULUM):
        with Path(path).open("rb") as stream:
            return cls(stream.read(1_048_577))

    def data(self):
        return json.loads(self.encoded)

    def sha256(self):
        return hashlib.sha256(b"AAI_TRADING_CURRICULUM_V1\0" + self.encoded).hexdigest()

    def track(self, track_id):
        require(type(track_id) is str, "UNKNOWN_TRACK")
        tracks = [row for row in self.data()["tracks"] if row["track_id"] == track_id]
        require(len(tracks) == 1, "UNKNOWN_TRACK")
        return tracks[0]

    def cases(self, track_id):
        lessons = self.track(track_id)["lessons"]
        return tuple(sorted((row for row in self.data()["cases"] if row["lesson_id"] in lessons),
                            key=lambda row: row["case_id"]))


@dataclass(frozen=True)
class Learner:
    module_id: str
    pipeline_sha256: str
    calibration_sha256: str | None = None

    def __post_init__(self):
        _name(self.module_id)
        _pin(self.pipeline_sha256)
        if self.calibration_sha256 is not None:
            _pin(self.calibration_sha256)


@dataclass(frozen=True)
class Answer:
    case_id: str
    choice: str

    def __post_init__(self):
        _name(self.case_id)
        require(type(self.choice) is str and 1 <= len(self.choice) <= 128, "INVALID_ANSWER")


@dataclass(frozen=True)
class PracticeAttempt:
    learner: Learner
    curriculum_sha256: str
    track_id: str
    started_ms: int
    completed_ms: int
    classification: str
    answers: tuple[Answer, ...]

    def __post_init__(self):
        require(type(self.learner) is Learner, "INVALID_LEARNER")
        _pin(self.curriculum_sha256)
        _name(self.track_id)
        for value in (self.started_ms, self.completed_ms):
            _time(value)
        require(self.started_ms <= self.completed_ms, "INVALID_ATTEMPT_TIME")
        require(self.classification in ("SYNTHETIC_FIXTURE", "OPERATOR_SUBMITTED"), "INVALID_ATTEMPT_CLASS")
        require(type(self.answers) is tuple and len(self.answers) <= 512
                and all(type(answer) is Answer for answer in self.answers), "INVALID_ANSWERS")
        require(len({answer.case_id for answer in self.answers}) == len(self.answers), "DUPLICATE_ANSWER")

    def sha256(self):
        data = asdict(self)
        data["answers"] = sorted(data["answers"], key=lambda row: row["case_id"])
        return digest("AAI_PUBLIC_PRACTICE_ATTEMPT_V1", data)


def parse_attempt(value):
    exact_fields(value, ("learner", "curriculum_sha256", "track_id", "started_ms", "completed_ms", "classification", "answers"))
    exact_fields(value["learner"], ("module_id", "pipeline_sha256", "calibration_sha256"))
    require(type(value["answers"]) is list and len(value["answers"]) <= 512, "INVALID_ANSWERS")
    for answer in value["answers"]:
        exact_fields(answer, ("case_id", "choice"))
    return PracticeAttempt(Learner(**value["learner"]), value["curriculum_sha256"], value["track_id"],
                           value["started_ms"], value["completed_ms"], value["classification"],
                           tuple(Answer(**answer) for answer in value["answers"]))


def assess(curriculum: Curriculum, attempt: PracticeAttempt, now_ms: int):
    require(type(curriculum) is Curriculum and type(attempt) is PracticeAttempt, "INVALID_ASSESSMENT")
    _time(now_ms)
    require(attempt.completed_ms <= now_ms, "FUTURE_ATTEMPT")
    require(attempt.curriculum_sha256 == curriculum.sha256(), "CURRICULUM_CHANGED")
    data, track = curriculum.data(), curriculum.track(attempt.track_id)
    require(attempt.started_ms >= data["reviewed_at_ms"], "ATTEMPT_PREDATES_CURRICULUM")
    expected = {case["case_id"]: case for case in curriculum.cases(attempt.track_id)}
    answers = {answer.case_id: answer.choice for answer in attempt.answers}
    require(not set(answers) - set(expected), "ANSWER_OUTSIDE_TRACK")
    require(all(answer in expected[key]["choices"] for key, answer in answers.items()), "INVALID_ANSWER_CHOICE")
    missing = sorted(set(expected) - set(answers))
    wrong = sorted(key for key, answer in answers.items() if answer != expected[key]["expected"])
    critical = sorted(key for key in missing + wrong if expected[key]["safety_critical"])
    score = (len(expected) - len(missing) - len(wrong)) * 1_000_000 // len(expected)
    status = "INCOMPLETE" if missing else "REMEDIATION_REQUIRED" if critical or score < data["minimum_score_ppm"] else "PRACTICE_COMPLETE"
    expires = min(attempt.completed_ms + 30 * DAY_MS, data["review_valid_until_ms"])
    reasons = list(track["paper_lab_blockers"])
    if status != "PRACTICE_COMPLETE":
        reasons.append("PUBLIC_PRACTICE_NOT_COMPLETE")
    if now_ms >= data["review_valid_until_ms"]:
        reasons.append("CURRICULUM_REVIEW_EXPIRED")
    if now_ms >= expires:
        reasons.append("PRACTICE_ASSESSMENT_EXPIRED")
    record = {"schema_version": 1, "assessment_scope": "PUBLIC_PRACTICE_ONLY", "classification": attempt.classification,
              "learner": asdict(attempt.learner), "curriculum_sha256": curriculum.sha256(),
              "attempt_sha256": attempt.sha256(), "track_id": attempt.track_id, "graded_at_ms": now_ms,
              "expires_at_ms": expires, "status": status, "score_ppm": score, "case_count": len(expected),
              "missing_cases": missing, "incorrect_cases": wrong, "failed_safety_cases": critical,
              "paper_lab_allowed": not reasons, "paper_lab_blockers": reasons,
              "model_training": "NOT_PERFORMED", "independent_knowledge_validation": "NOT_ESTABLISHED",
              "live_execution_allowed": False, "live_blockers": list(LIVE_BLOCKERS), "action": "NO_EXECUTION"}
    return {**record, "record_sha256": digest("AAI_PUBLIC_PRACTICE_ASSESSMENT_V1", record)}


def verify_assessment(curriculum, attempt, record, now_ms):
    _time(now_ms)
    require(type(record) is dict and type(record.get("graded_at_ms")) is int, "INVALID_ASSESSMENT_RECORD")
    require(canonical(record) == canonical(assess(curriculum, attempt, record["graded_at_ms"])), "ASSESSMENT_RECORD_MISMATCH")
    require(now_ms >= record["graded_at_ms"], "ASSESSMENT_CLOCK_REGRESSION")
    # Recompute current admission: a previously valid grade cannot defeat expiry.
    return assess(curriculum, attempt, now_ms)


@dataclass(frozen=True)
class EvaluationPlan:
    """Chronological envelope checks, not row-level leakage or statistical-power proof."""
    train_start_ms: int
    train_end_ms: int
    validation_start_ms: int
    validation_end_ms: int
    test_start_ms: int
    test_end_ms: int
    forward_start_ms: int
    horizon_ms: int
    embargo_ms: int
    dataset_manifest_sha256: str
    trial_registry_sha256: str
    cost_model_sha256: str
    frozen_parameters_sha256: str

    def __post_init__(self):
        for value in (self.train_start_ms, self.train_end_ms, self.validation_start_ms, self.validation_end_ms,
                      self.test_start_ms, self.test_end_ms, self.forward_start_ms):
            _time(value)
        require(type(self.horizon_ms) is int and 1 <= self.horizon_ms <= 604_800_000
                and type(self.embargo_ms) is int and self.horizon_ms <= self.embargo_ms <= 604_800_000,
                "INVALID_HORIZON_OR_EMBARGO")
        require(self.train_start_ms < self.train_end_ms
                and self.train_end_ms + self.embargo_ms <= self.validation_start_ms < self.validation_end_ms
                and self.validation_end_ms + self.embargo_ms <= self.test_start_ms < self.test_end_ms
                and self.test_end_ms + self.embargo_ms <= self.forward_start_ms, "OVERLAPPING_EVALUATION_SPLITS")
        for value in (self.dataset_manifest_sha256, self.trial_registry_sha256,
                      self.cost_model_sha256, self.frozen_parameters_sha256):
            _pin(value)

    def sha256(self):
        return digest("AAI_RESEARCH_EVALUATION_PLAN_V1", asdict(self))


class SchoolObservationRound:
    """Education-gated Solana research comparison, still without any execution path.

    Existing ObservationRound remains a lower-level NO_EXECUTION research API.
    This wrapper adds practice admission; it does not certify a market model.
    """
    __slots__ = ("_inner", "_school_records")

    def __init__(self, policy, pair, snapshot, curriculum, attempts):
        from .consensus import ConsensusPolicy, ObservationRound, PairIdentity

        require(type(policy) is ConsensusPolicy and type(pair) is PairIdentity and type(snapshot) is Snapshot, "INVALID_SCHOOL_ROUND")
        require(type(attempts) is tuple and len(attempts) == len(policy.modules)
                and all(type(attempt) is PracticeAttempt for attempt in attempts), "EDUCATION_ROSTER_REQUIRED")
        by_id = {attempt.learner.module_id: attempt for attempt in attempts}
        require(len(by_id) == len(attempts) and set(by_id) == {module.module_id for module in policy.modules},
                "EDUCATION_ROSTER_MISMATCH")
        records = []
        for module in sorted(policy.modules, key=lambda spec: spec.module_id):
            attempt = by_id[module.module_id]
            require(policy.classification == "SYNTHETIC_FIXTURE" or attempt.classification == "OPERATOR_SUBMITTED",
                    "SYNTHETIC_PRACTICE_IS_NOT_MODEL_EVIDENCE")
            require(attempt.track_id == "solana" and pair.chain == "solana", "EDUCATION_TRACK_MISMATCH")
            require(attempt.learner.pipeline_sha256 == module.pipeline_sha256()
                    and attempt.learner.calibration_sha256 == module.calibration_sha256, "EDUCATION_PIPELINE_CHANGED")
            record = assess(curriculum, attempt, snapshot.decision_time_ms)
            require(record["paper_lab_allowed"], "EDUCATION_PRACTICE_REQUIRED")
            records.append(record)
        self._school_records = tuple(canonical(record) for record in records)
        self._inner = ObservationRound(policy, pair, snapshot)

    def submit(self, receipt):
        return self._inner.submit(receipt)

    def finalize(self, now_ms):
        # Expiration is rechecked at the close, not only on construction.
        _time(now_ms)
        require(all(now_ms < json.loads(record)["expires_at_ms"] for record in self._school_records),
                "EDUCATION_PRACTICE_EXPIRED")
        consensus = self._inner.finalize(now_ms)
        record = {"schema_version": 1, "consensus": consensus,
                  "practice_assessments": [json.loads(row) for row in self._school_records],
                  "action": "NO_EXECUTION", "live_execution_allowed": False,
                  "live_blockers": list(LIVE_BLOCKERS)}
        return {**record, "record_sha256": digest("AAI_EDUCATED_RESEARCH_ROUND_V1", record)}
