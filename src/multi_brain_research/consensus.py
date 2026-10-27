"""Join independent worker receipts on one frozen market observation; never execute."""

from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib

from .contracts import ContractError, Measurement, ModuleOutput, Snapshot, _name, _pin, _time
from .graph import canonical

BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def _require(condition: bool, reason: str):
    if not condition:
        raise ContractError(reason)


def digest(domain: str, value: object) -> str:
    return hashlib.sha256(domain.encode("ascii") + b"\0" + canonical(value)).hexdigest()


def _address(value: str):
    """Validate canonical 32-byte Solana address encoding, not account existence."""
    _require(type(value) is str and 32 <= len(value) <= 44, "INVALID_ADDRESS")
    number = 0
    for char in value:
        _require(char in BASE58, "INVALID_ADDRESS")
        number = number * 58 + BASE58.index(char)
    zeros = len(value) - len(value.lstrip("1"))
    _require(zeros + (number.bit_length() + 7) // 8 == 32, "INVALID_ADDRESS")


@dataclass(frozen=True)
class PairIdentity:
    chain: str
    network: str
    venue: str
    pool_address: str
    base_mint: str
    quote_mint: str

    def __post_init__(self):
        _require(self.chain == "solana" and self.network in ("mainnet", "devnet", "testnet"),
                 "UNSUPPORTED_CHAIN_OR_NETWORK")
        _name(self.venue)
        for value in (self.pool_address, self.base_mint, self.quote_mint):
            _address(value)
        _require(self.base_mint != self.quote_mint, "IDENTICAL_PAIR_ASSETS")

    def sha256(self):
        return digest("BUILDWITHAAI_PAIR_V1", asdict(self))

    def entity_id(self):
        # Snapshot identifiers are bounded lowercase names; retain 240 identity bits.
        return "p_" + self.sha256()[:60]


@dataclass(frozen=True)
class FeatureSpec:
    feature_id: str
    unit: str
    classification: str

    def __post_init__(self):
        # Reuse the existing feature registry/type validation without inventing a value.
        Measurement(self.feature_id, None, self.unit, self.classification,
                    None, 0, 0, "schema_check", "schema_v1", "1" * 64, "UNKNOWN")


@dataclass(frozen=True)
class ModuleSpec:
    module_id: str
    source_id: str
    graph_sha256: str | None
    checkpoint_sha256: str | None
    encoder_sha256: str | None
    readout_sha256: str | None
    calibration_sha256: str | None

    def __post_init__(self):
        _name(self.module_id)
        _name(self.source_id)
        for value in (self.graph_sha256, self.checkpoint_sha256, self.encoder_sha256,
                      self.readout_sha256, self.calibration_sha256):
            if value is not None:
                _pin(value)

    def missing_components(self):
        return tuple(name for name in ("graph", "checkpoint", "encoder", "readout", "calibration")
                     if getattr(self, name + "_sha256") is None)

    def pipeline_sha256(self):
        # Module/source names and calibration receipts cannot disguise an exact clone.
        return digest("BUILDWITHAAI_MARKET_PIPELINE_V1", {
            name: getattr(self, name + "_sha256")
            for name in ("graph", "checkpoint", "encoder", "readout")})


@dataclass(frozen=True)
class ConsensusPolicy:
    policy_id: str
    classification: str
    modules: tuple[ModuleSpec, ...]
    features: tuple[FeatureSpec, ...]
    feature_set_sha256: str
    task_sha256: str
    horizon_ms: int
    buy_threshold_ppm: int
    max_uncertainty_ppm: int
    max_observation_age_ms: int
    max_decision_latency_ms: int

    def __post_init__(self):
        _name(self.policy_id)
        _require(self.classification in ("SYNTHETIC_FIXTURE", "UNVALIDATED_RESEARCH"), "UNSUPPORTED_MODE")
        for value in (self.feature_set_sha256, self.task_sha256):
            _pin(value)
        _require(type(self.modules) is tuple and 2 <= len(self.modules) <= 16, "INVALID_MODULE_ROSTER")
        _require(all(type(m) is ModuleSpec for m in self.modules), "INVALID_MODULE_SPEC")
        _require(len({m.module_id for m in self.modules}) == len(self.modules), "DUPLICATE_MODULE")
        ready = [m.pipeline_sha256() for m in self.modules if not m.missing_components()]
        _require(len(set(ready)) == len(ready), "DUPLICATE_MARKET_PIPELINE")
        _require(type(self.features) is tuple and 1 <= len(self.features) <= 64
                 and all(type(f) is FeatureSpec for f in self.features), "INVALID_FEATURE_SCHEMA")
        _require(len({f.feature_id for f in self.features}) == len(self.features), "DUPLICATE_FEATURE")
        for value in (self.buy_threshold_ppm, self.max_uncertainty_ppm):
            _require(type(value) is int and 0 <= value <= 1_000_000, "INVALID_SCORE_THRESHOLD")
        for value, bound in ((self.horizon_ms, 604800000), (self.max_observation_age_ms, 86400000),
                             (self.max_decision_latency_ms, 60000)):
            _require(type(value) is int and 1 <= value <= bound, "INVALID_TIME_BUDGET")
        _require(self.max_decision_latency_ms < self.horizon_ms, "DEADLINE_REACHES_TARGET_HORIZON")

    def sha256(self):
        data = asdict(self)
        data["modules"] = sorted(data["modules"], key=lambda x: x["module_id"])
        data["features"] = sorted(data["features"], key=lambda x: x["feature_id"])
        return digest("BUILDWITHAAI_UNANIMITY_POLICY_V1", data)


@dataclass(frozen=True)
class Receipt:
    output: ModuleOutput
    received_time_ms: int

    def __post_init__(self):
        _require(type(self.output) is ModuleOutput, "INVALID_RECEIPT_OUTPUT")
        _time(self.received_time_ms)
        _require(self.output.produced_time_ms <= self.received_time_ms, "RECEIPT_PRECEDES_OUTPUT")


class ObservationRound:
    """One pair, snapshot and policy; retain all configured voters, including outages.

    This in-memory receipt collector imports no model and handles no wallet. An
    external trusted worker must independently produce each ModuleOutput.
    """

    __slots__ = ("_policy", "_pair", "_snapshot", "_round_id", "_receipts", "_clock", "_closed", "_faults")

    @property
    def policy(self):
        return self._policy

    @property
    def pair(self):
        return self._pair

    @property
    def snapshot(self):
        return self._snapshot

    @property
    def round_id(self):
        return self._round_id

    def __init__(self, policy: ConsensusPolicy, pair: PairIdentity, snapshot: Snapshot):
        _require(type(policy) is ConsensusPolicy and type(pair) is PairIdentity
                 and type(snapshot) is Snapshot, "INVALID_ROUND_INPUT")
        _require(snapshot.entity_id == pair.entity_id(), "PAIR_SNAPSHOT_MISMATCH")
        _require(snapshot.feature_set_sha256 == policy.feature_set_sha256, "FEATURE_SET_MISMATCH")
        _require(snapshot.max_observation_age_ms == policy.max_observation_age_ms, "AGE_POLICY_MISMATCH")
        actual = {(m.feature_id, m.unit, m.classification) for m in snapshot.measurements}
        expected = {(f.feature_id, f.unit, f.classification) for f in policy.features}
        _require(actual == expected, "FEATURE_SCHEMA_MISMATCH")
        self._policy, self._pair, self._snapshot = policy, pair, snapshot
        _time(snapshot.decision_time_ms + policy.max_decision_latency_ms)
        self._round_id = digest("BUILDWITHAAI_OBSERVATION_ROUND_V1", {
            "policy": policy.sha256(), "pair": pair.sha256(), "snapshot": snapshot.sha256()})
        self._receipts = {}
        self._clock = snapshot.decision_time_ms
        self._closed = False
        self._faults = set()

    def submit(self, receipt: Receipt):
        try:
            self._accept(receipt)
        except ContractError as exc:
            if not self._closed:
                self._faults.add(str(exc))
            raise

    def _accept(self, receipt: Receipt):
        _require(not self._closed, "ROUND_CLOSED")
        _require(type(receipt) is Receipt, "INVALID_RECEIPT")
        output = receipt.output
        specs = {m.module_id: m for m in self.policy.modules}
        _require(output.module_id in specs, "UNREGISTERED_MODULE")
        spec = specs[output.module_id]
        _require(not spec.missing_components(), "MODULE_PIPELINE_UNAVAILABLE")
        _require(output.module_id not in self._receipts, "DUPLICATE_MODULE_RECEIPT")
        output.bind(self.snapshot)
        _require((output.source_id, output.graph_sha256, output.model_sha256) ==
                 (spec.source_id, spec.graph_sha256, spec.pipeline_sha256()), "MODULE_PROVENANCE_MISMATCH")
        _require((output.task_sha256, output.horizon_ms) ==
                 (self.policy.task_sha256, self.policy.horizon_ms), "TASK_OR_HORIZON_MISMATCH")
        _require(receipt.received_time_ms >= self._clock, "NONMONOTONIC_RECEIPT_TIME")
        self._clock = receipt.received_time_ms
        self._receipts[output.module_id] = receipt

    def status(self, now_ms: int) -> dict:
        _require(not self._closed, "ROUND_CLOSED")
        _time(now_ms)
        _require(now_ms >= self._clock, "CLOCK_BEFORE_RECEIPTS")
        self._clock = now_ms
        deadline = self.snapshot.decision_time_ms + self.policy.max_decision_latency_ms
        _time(deadline)
        rows, missing = [], False
        for spec in sorted(self.policy.modules, key=lambda x: x.module_id):
            receipt = self._receipts.get(spec.module_id)
            row = {"module_id": spec.module_id, "source_id": spec.source_id,
                   "pipeline_sha256": spec.pipeline_sha256(),
                   "produced_time_ms": receipt.output.produced_time_ms if receipt else None,
                   "received_time_ms": receipt.received_time_ms if receipt else None,
                   "receipt_sha256": digest("BUILDWITHAAI_MODULE_RECEIPT_V1", asdict(receipt)) if receipt else None,
                   "prediction_ppm": None, "uncertainty_ppm": None}
            if spec.missing_components():
                vote, reason = "UNAVAILABLE", "MISSING_" + "_".join(spec.missing_components()).upper()
            elif receipt is None:
                missing = True
                vote, reason = ("WAITING", "MODULE_NOT_RECEIVED") if now_ms < deadline else ("ABSTAIN", "MODULE_TIMEOUT")
            elif receipt.received_time_ms > deadline:
                vote, reason = "ABSTAIN", "LATE_RECEIPT"
            elif receipt.output.abstain_reason:
                vote, reason = "ABSTAIN", receipt.output.abstain_reason
            elif receipt.output.uncertainty_ppm > self.policy.max_uncertainty_ppm:
                vote, reason = "ABSTAIN", "UNCERTAINTY_ABOVE_LIMIT"
            else:
                vote = "BUY_SUPPORT" if receipt.output.prediction_ppm >= self.policy.buy_threshold_ppm else "NO_BUY_SUPPORT"
                reason = "SCORE_AT_OR_ABOVE_THRESHOLD" if vote == "BUY_SUPPORT" else "SCORE_BELOW_THRESHOLD"
            if receipt:
                row.update(prediction_ppm=receipt.output.prediction_ppm,
                           uncertainty_ppm=receipt.output.uncertainty_ppm)
            rows.append({**row, "vote": vote, "reason": reason})
        reasons = ["INVALID_WORKER_RECEIPT"] if self._faults else []
        if any(m.value is None for m in self.snapshot.measurements):
            reasons.append("MISSING_REQUIRED_DATA")
        if any(now_ms - m.observed_time_ms > self.policy.max_observation_age_ms
               for m in self.snapshot.measurements):
            reasons.append("OBSERVATION_STALE_AT_CLOSE")
        if now_ms > deadline:
            reasons.append("ROUND_EXPIRED")
        if any(row["vote"] in ("UNAVAILABLE", "ABSTAIN") for row in rows):
            reasons.append("REQUIRED_MODULE_ABSTAINED_OR_UNAVAILABLE")
        if missing and now_ms < deadline and not reasons:
            signal = "WAITING"
        elif reasons:
            signal = "ABSTAIN"
        elif all(row["vote"] == "BUY_SUPPORT" for row in rows):
            signal = "UNANIMOUS_BUY_CANDIDATE"
        else:
            signal = "NO_BUY"
            reasons.append("NOT_ALL_REQUIRED_MODULES_SUPPORT_BUY")
        record = {
            "schema_version": 1, "classification": self.policy.classification,
            "round_id": self.round_id, "policy_sha256": self.policy.sha256(),
            "pair": asdict(self.pair), "pair_sha256": self.pair.sha256(),
            "snapshot_sha256": self.snapshot.sha256(), "decision_time_ms": self.snapshot.decision_time_ms,
            "input_classifications": sorted({m.classification for m in self.snapshot.measurements}),
            "as_of_time_ms": now_ms, "deadline_ms": deadline,
            "task_sha256": self.policy.task_sha256, "horizon_ms": self.policy.horizon_ms,
            "required_modules": len(rows), "received_modules": len(self._receipts),
            "buy_support_count": sum(row["vote"] == "BUY_SUPPORT" for row in rows),
            "receipt_errors": sorted(self._faults),
            "modules": rows, "research_signal": signal, "reasons": reasons,
            "action": "NO_EXECUTION", "execution_allowed": False,
            "risk_policy": "NOT_EVALUATED", "market_validation": "NOT_ESTABLISHED",
            "calibration": "NOT_INDEPENDENTLY_VERIFIED", "independence": "NOT_ESTABLISHED",
            "execution_attestation": "NOT_ESTABLISHED",
        }
        return {**record, "record_sha256": digest("BUILDWITHAAI_CONSENSUS_RECORD_V1", record)}

    def finalize(self, now_ms: int) -> dict:
        record = self.status(now_ms)
        _require(record["research_signal"] != "WAITING", "REQUIRED_MODULES_STILL_PENDING")
        self._closed = True
        return record
