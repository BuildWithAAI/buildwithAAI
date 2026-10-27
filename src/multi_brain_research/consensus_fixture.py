"""SYNTHETIC software scenarios, not animal-model inference or market observations."""

from dataclasses import asdict, replace

from .consensus import (BASE58, ConsensusPolicy, FeatureSpec, ModuleSpec,
                        ObservationRound, PairIdentity, Receipt, digest)
from .contracts import Measurement, ModuleOutput, Snapshot


def pin(name):
    return digest("SYNTHETIC_TEST_IDENTIFIER_ONLY", name)


def address(number):
    """Deterministic format-valid synthetic key; no assertion about on-chain accounts."""
    value = int.from_bytes(bytes([number]) * 32, "big")
    result = ""
    while value:
        value, remainder = divmod(value, 58)
        result = BASE58[remainder] + result
    return result


def pair():
    return PairIdentity("solana", "devnet", "fixture_venue", address(1), address(2), address(3))


def policy():
    modules = tuple(ModuleSpec("fixture_" + letter, "synthetic_fixture",
                              *(pin(letter + "_" + component) for component in
                                ("graph", "checkpoint", "encoder", "readout", "calibration")))
                    for letter in "abcd")
    return ConsensusPolicy(
        "synthetic_unanimity_v1", "SYNTHETIC_FIXTURE", modules,
        (FeatureSpec("M-001", "quote_atomic_per_base", "SYNTHETIC"),),
        pin("fixture_feature_set"), pin("fixture_positive_class_at_60s"),
        60000, 700000, 200000, 100, 50)


def snapshot(config=None, identity=None, at=1000, missing=False):
    config, identity = config or policy(), identity or pair()
    measurement = Measurement("M-001", None if missing else 1200, "quote_atomic_per_base", "SYNTHETIC",
                              at - 20, at - 10, at - 5, "synthetic_fixture", "fixture_v1",
                              pin("synthetic_price_input"), "SOURCE_UNAVAILABLE" if missing else None)
    return Snapshot(identity.entity_id(), at, config.feature_set_sha256,
                    config.max_observation_age_ms, (measurement,))


def receipt(spec, observation, config=None, score=800000, uncertainty=100000,
            abstain=None, received=None):
    config = config or policy()
    produced = observation.decision_time_ms + 1
    return Receipt(ModuleOutput(
        spec.module_id, spec.source_id, spec.graph_sha256, spec.pipeline_sha256(),
        config.task_sha256, config.horizon_ms, observation.sha256(), produced,
        None if abstain else score, None if abstain else uncertainty, abstain),
        observation.decision_time_ms + 2 if received is None else received)


SCENARIOS = {
    "unanimous": "UNANIMOUS_BUY_CANDIDATE",
    "disagreement": "NO_BUY",
    "uncertainty": "ABSTAIN",
    "abstention": "ABSTAIN",
    "missing_module": "ABSTAIN",
    "late_module": "ABSTAIN",
    "missing_data": "ABSTAIN",
    "stale_data": "ABSTAIN",
    "missing_encoder": "ABSTAIN",
}


def events_for_scenarios():
    config, identity = policy(), pair()
    events, expected = [], []
    # Missing encoder has a separate immutable policy, not a mid-round change.
    for index, (name, signal) in enumerate((x for x in SCENARIOS.items() if x[0] != "missing_encoder")):
        at = 1000 + index * 1000
        observation = snapshot(config, identity, at, missing=name == "missing_data")
        if name == "stale_data":
            observation = replace(observation, measurements=(replace(observation.measurements[0],
                                  event_time_ms=at-100, observed_time_ms=at-100, available_time_ms=at-5),))
        round_id = ObservationRound(config, identity, observation).round_id
        events.append({"event": "OPEN", "pair": asdict(identity), "snapshot": asdict(observation)})
        events.append({"event": "POLL", "round_id": round_id, "now_ms": at})
        for module_index, spec in enumerate(config.modules):
            if name == "missing_module" and module_index == 3:
                continue
            kwargs = {}
            if module_index == 3:
                if name == "disagreement": kwargs["score"] = 300000
                if name == "uncertainty": kwargs["uncertainty"] = 300000
                if name == "abstention": kwargs["abstain"] = "OUT_OF_DOMAIN"
                if name == "late_module": kwargs["received"] = at + 51
            result = receipt(spec, observation, config, **kwargs)
            events.append({"event": "RECEIPT", "round_id": round_id, "receipt": asdict(result)})
        close = at + (51 if name == "late_module" else 50 if name == "missing_module" else 2)
        events.append({"event": "FINALIZE", "round_id": round_id, "now_ms": close})
        expected.append({"scenario": name, "round_id": round_id, "research_signal": signal})
    return config, events, expected


def unavailable_policy():
    config = policy()
    return replace(config, modules=(*config.modules[:3], replace(config.modules[3], encoder_sha256=None)))
