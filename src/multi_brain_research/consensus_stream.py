"""Bounded JSONL replay of separate workers' observation-round events."""

from __future__ import annotations

from dataclasses import asdict, fields
import json

from .consensus import ConsensusPolicy, FeatureSpec, ModuleSpec, ObservationRound, PairIdentity, Receipt
from .contracts import ContractError, Measurement, ModuleOutput, Snapshot
from .graph import canonical

MAX_LINE_BYTES = 65536
MAX_STREAM_BYTES = 16 * 1024**2
MAX_EVENTS = 20000
MAX_ROUNDS = 1000


def require(condition, reason):
    if not condition:
        raise ContractError(reason)


def decode(data: bytes):
    require(type(data) is bytes and 0 < len(data) <= MAX_LINE_BYTES, "JSON_RECORD_SIZE_LIMIT")

    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, "DUPLICATE_JSON_KEY")
            result[key] = value
        return result

    def constant(_):
        raise ContractError("NONFINITE_JSON")

    try:
        return json.loads(data, object_pairs_hook=pairs, parse_constant=constant)
    except (ValueError, UnicodeError, RecursionError) as exc:
        if type(exc) is ContractError:
            raise
        raise ContractError("INVALID_JSON") from None


def construct(cls, values):
    require(type(values) is dict and set(values) == {f.name for f in fields(cls)}, "INVALID_RECORD_FIELDS")
    try:
        return cls(**values)
    except (TypeError, KeyError, AttributeError):
        raise ContractError("INVALID_RECORD_TYPES") from None


def parse_policy(data: bytes) -> ConsensusPolicy:
    raw = decode(data)
    require(type(raw) is dict and type(raw.get("modules")) is list
            and type(raw.get("features")) is list, "INVALID_POLICY")
    require(2 <= len(raw["modules"]) <= 16 and 1 <= len(raw["features"]) <= 64, "INVALID_POLICY_BOUNDS")
    raw["modules"] = tuple(construct(ModuleSpec, x) for x in raw["modules"])
    raw["features"] = tuple(construct(FeatureSpec, x) for x in raw["features"])
    return construct(ConsensusPolicy, raw)


def parse_snapshot(values) -> Snapshot:
    require(type(values) is dict and type(values.get("measurements")) is list, "INVALID_SNAPSHOT")
    require(1 <= len(values["measurements"]) <= 64, "INVALID_MEASUREMENT_BOUND")
    values = {**values, "measurements": tuple(construct(Measurement, m) for m in values["measurements"])}
    return construct(Snapshot, values)


def replay_stream(policy: ConsensusPolicy, source, destination) -> dict:
    """One active round, exact schemas, fixed roster, terminal records and hard bounds.

    Replay timestamps are submitted evidence, not trusted live-clock attestation.
    No dynamic import, model inference, network call, wallet or execution method.
    """
    active, seen, events, total, written, rounds = None, set(), 0, 0, 0, 0

    def emit(value):
        nonlocal written
        data = canonical(value) + b"\n"
        written += len(data)
        require(written <= MAX_STREAM_BYTES, "OUTPUT_STREAM_SIZE_LIMIT")
        destination.write(data)
        destination.flush()

    emit({"event": "POLICY", "classification": policy.classification, "policy_sha256": policy.sha256(),
          "policy": asdict(policy), "action": "NO_EXECUTION"})
    while raw := source.readline(MAX_LINE_BYTES + 1):
        total += len(raw)
        events += 1
        require(total <= MAX_STREAM_BYTES and events <= MAX_EVENTS, "INPUT_STREAM_LIMIT")
        event = decode(raw)
        require(type(event) is dict and type(event.get("event")) is str, "INVALID_EVENT")
        kind = event["event"]
        if kind == "OPEN":
            require(set(event) == {"event", "pair", "snapshot"}, "INVALID_EVENT_FIELDS")
            require(active is None, "ROUND_ALREADY_OPEN")
            require(rounds < MAX_ROUNDS, "ROUND_LIMIT")
            active = ObservationRound(policy, construct(PairIdentity, event["pair"]), parse_snapshot(event["snapshot"]))
            require(active.round_id not in seen, "REPLAYED_ROUND")
            seen.add(active.round_id)
            emit({"event": "OPENED", "round_id": active.round_id, "pair": event["pair"],
                  "snapshot": event["snapshot"], "action": "NO_EXECUTION"})
        elif kind in ("RECEIPT", "POLL", "FINALIZE"):
            require(active is not None, "NO_OPEN_ROUND")
            require(event.get("round_id") == active.round_id, "ROUND_ID_MISMATCH")
            if kind == "RECEIPT":
                require(set(event) == {"event", "round_id", "receipt"}, "INVALID_EVENT_FIELDS")
                item = event["receipt"]
                require(type(item) is dict and set(item) == {"output", "received_time_ms"}, "INVALID_RECEIPT_FIELDS")
                output = construct(ModuleOutput, item["output"])
                receipt = Receipt(output, item["received_time_ms"])
                active.submit(receipt)
                emit({"event": "RECEIVED", "round_id": active.round_id, "receipt": item,
                      "action": "NO_EXECUTION"})
            else:
                require(set(event) == {"event", "round_id", "now_ms"}, "INVALID_EVENT_FIELDS")
                record = active.status(event["now_ms"]) if kind == "POLL" else active.finalize(event["now_ms"])
                emit({"event": "STATUS" if kind == "POLL" else "FINALIZED", "record": record})
                if kind == "FINALIZE":
                    active = None
                    rounds += 1
        else:
            raise ContractError("UNSUPPORTED_EVENT")
    require(active is None, "INCOMPLETE_ROUND")
    require(rounds > 0, "NO_COMPLETED_ROUNDS")
    return {"rounds": rounds, "events": events, "input_bytes": total, "output_bytes": written,
            "classification": policy.classification, "action": "NO_EXECUTION", "execution_allowed": False}
