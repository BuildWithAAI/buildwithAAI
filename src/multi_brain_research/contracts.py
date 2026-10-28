"""Species-neutral causal research records. No module inference or trading policy."""
from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import re

from .graph import canonical

MAX_TIME_MS = 253402300799999
CLASSES = {"OBSERVED", "DERIVED", "INFERRED", "LEARNED", "SYNTHETIC"}
MISSING = {"SOURCE_UNAVAILABLE", "SOURCE_NOT_YET_AVAILABLE", "PARSE_FAILED", "UNSUPPORTED_VERSION", "RATE_LIMITED", "UNKNOWN"}


class ContractError(ValueError):
    pass


def _time(value: int) -> None:
    if type(value) is not int or not 0 <= value <= MAX_TIME_MS:
        raise ContractError("INVALID_TIME")


def _pin(value: str) -> None:
    if type(value) is not str or not re.fullmatch(r"[0-9a-f]{64}", value) or value == "0" * 64:
        raise ContractError("INVALID_PIN")


def _name(value: str) -> None:
    if type(value) is not str or not re.fullmatch(r"[a-z][a-z0-9_]{2,63}", value):
        raise ContractError("INVALID_IDENTIFIER")


@dataclass(frozen=True)
class Measurement:
    feature_id: str
    value: int | None
    unit: str
    classification: str
    event_time_ms: int | None
    observed_time_ms: int
    available_time_ms: int
    source_id: str
    source_version: str
    lineage_sha256: str
    missing_reason: str | None

    def __post_init__(self):
        if type(self.feature_id) is not str or not re.fullmatch(r"[SMTWCQ]-[0-9]{3}", self.feature_id):
            raise ContractError("UNREGISTERED_FEATURE_OR_LABEL")
        limits = {"S": 10, "M": 10, "T": 10, "W": 10, "C": 7, "Q": 8}
        if not 1 <= int(self.feature_id[2:]) <= limits[self.feature_id[0]]:
            raise ContractError("UNREGISTERED_FEATURE_OR_LABEL")
        if type(self.classification) is not str or self.classification not in CLASSES:
            raise ContractError("INVALID_CLASSIFICATION_OR_LABEL")
        for value in (self.observed_time_ms, self.available_time_ms):
            _time(value)
        if self.event_time_ms is not None:
            _time(self.event_time_ms)
            if self.event_time_ms > self.observed_time_ms:
                raise ContractError("INVALID_TIME_ORDER")
        if self.observed_time_ms > self.available_time_ms:
            raise ContractError("INVALID_TIME_ORDER")
        for value in (self.unit, self.source_id, self.source_version):
            _name(value)
        _pin(self.lineage_sha256)
        if self.value is None:
            if type(self.missing_reason) is not str or self.missing_reason not in MISSING:
                raise ContractError("MISSING_REASON_REQUIRED")
        elif (type(self.value) is not int or not -(2**63) <= self.value < 2**64 or self.missing_reason is not None):
            raise ContractError("INVALID_EXACT_VALUE")


@dataclass(frozen=True)
class Snapshot:
    entity_id: str
    decision_time_ms: int
    feature_set_sha256: str
    max_observation_age_ms: int
    measurements: tuple[Measurement, ...]

    def __post_init__(self):
        _name(self.entity_id)
        _time(self.decision_time_ms)
        _pin(self.feature_set_sha256)
        if type(self.max_observation_age_ms) is not int or not 1 <= self.max_observation_age_ms <= 86400000:
            raise ContractError("INVALID_AGE_LIMIT")
        if type(self.measurements) is not tuple or not 1 <= len(self.measurements) <= 64:
            raise ContractError("INVALID_MEASUREMENT_BOUND")
        ids = set()
        for m in self.measurements:
            if type(m) is not Measurement or m.feature_id in ids:
                raise ContractError("INVALID_OR_DUPLICATE_MEASUREMENT")
            ids.add(m.feature_id)
            if m.available_time_ms > self.decision_time_ms:
                raise ContractError("FUTURE_DATA")
            if self.decision_time_ms - m.observed_time_ms > self.max_observation_age_ms:
                raise ContractError("STALE_DATA")

    def sha256(self) -> str:
        payload = asdict(self)
        payload["measurements"] = sorted(payload["measurements"], key=lambda m: m["feature_id"])
        return hashlib.sha256(b"BUILDWITHAAI_MB_SNAPSHOT_V1\0" + canonical(payload)).hexdigest()


@dataclass(frozen=True)
class ModuleOutput:
    module_id: str
    source_id: str
    graph_sha256: str
    model_sha256: str
    task_sha256: str
    horizon_ms: int
    snapshot_sha256: str
    produced_time_ms: int
    prediction_ppm: int | None
    uncertainty_ppm: int | None
    abstain_reason: str | None

    def __post_init__(self):
        _name(self.module_id)
        _name(self.source_id)
        for pin in (self.graph_sha256, self.model_sha256, self.task_sha256, self.snapshot_sha256):
            _pin(pin)
        if type(self.horizon_ms) is not int or not 1 <= self.horizon_ms <= 604800000:
            raise ContractError("INVALID_HORIZON")
        _time(self.produced_time_ms)
        if self.prediction_ppm is None:
            if self.uncertainty_ppm is not None or type(self.abstain_reason) is not str or self.abstain_reason not in {"MISSING_DATA", "UNCALIBRATED", "OUT_OF_DOMAIN", "MODULE_FAILED"}:
                raise ContractError("INVALID_ABSTENTION")
        elif (self.abstain_reason is not None or any(type(v) is not int or not 0 <= v <= 1000000
                for v in (self.prediction_ppm, self.uncertainty_ppm))):
            raise ContractError("INVALID_OUTPUT")

    def bind(self, snapshot: Snapshot) -> None:
        if self.snapshot_sha256 != snapshot.sha256() or self.produced_time_ms < snapshot.decision_time_ms:
            raise ContractError("OUTPUT_SNAPSHOT_MISMATCH")


def compare(outputs: tuple[ModuleOutput, ...], snapshot: Snapshot) -> dict:
    """Compare receipts without converting consensus into a trade or calibrated confidence."""
    if type(outputs) is not tuple or not 1 <= len(outputs) <= 16:
        raise ContractError("INVALID_MODULE_BOUND")
    seen = set()
    task = None
    for output in outputs:
        if type(output) is not ModuleOutput or output.module_id in seen:
            raise ContractError("DUPLICATE_OR_INVALID_MODULE")
        seen.add(output.module_id)
        output.bind(snapshot)
        signature = (output.task_sha256, output.horizon_ms)
        if task is not None and signature != task:
            raise ContractError("TASK_OR_HORIZON_MISMATCH")
        task = signature
    values = [o.prediction_ppm for o in outputs if o.prediction_ppm is not None]
    return {"classification": "UNTRUSTED_RESEARCH_RECEIPT_COMPARISON", "snapshot_sha256": snapshot.sha256(),
            "task_sha256": task[0], "horizon_ms": task[1],
            "reported_outputs": len(values), "abstentions": len(outputs) - len(values),
            "reported_range_ppm": max(values) - min(values) if values else None,
            "action": "NO_EXECUTION", "calibration": "NOT_ESTABLISHED", "independence": "NOT_ESTABLISHED"}
