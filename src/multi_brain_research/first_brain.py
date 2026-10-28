"""First brain: hemibrain subgraph, synthetic rate dynamics, adverse-move readout.

Wiring is the pinned FlyEM subset. Dynamics, encoder and readout are ours.
No orders, no wallet, no claim of market skill. A caller must pass real
chronological episodes; the self-check uses labeled SYNTHETIC rows only.
"""
from __future__ import annotations

import hashlib
import json
import math
import random
from pathlib import Path

MODULE_ID = "fly_hemibrain_adverse_v1"
SOURCE_ID = "flyem_hemibrain_v1_2"
HORIZON_MS = 300_000
FEE_BPS = 100
ADVERSE_DROP_PPM = 150_000
GRAPH_SHA256 = "014a6eebb4ff0586e6a94acb88b188ba0ddaf8421a924dad16cd104ad16cd43b"
INPUT_COUNT = 8
OUTPUT_COUNT = 8
STEPS = 4
DECAY = 0.5

TASK = {
    "task_id": "adverse_move_after_fee_v1",
    "question": "Will executable price fall by at least 15 percent over the next 5 minutes after a 1 percent fee?",
    "horizon_ms": HORIZON_MS,
    "fee_bps": FEE_BPS,
    "adverse_drop_ppm": ADVERSE_DROP_PPM,
    "features": ("signed_return", "flow_imbalance", "liquidity_change", "distance_to_adverse_band"),
    "feature_time": "decision_time_only",
    "splits": "earliest_train_middle_threshold_last_once",
    "action": "NO_EXECUTION",
}


class FirstBrainError(ValueError):
    pass


def _canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode("ascii")


def _sha(prefix: bytes, payload: object) -> str:
    return hashlib.sha256(prefix + _canonical(payload)).hexdigest()


def load_graph(path: Path) -> dict:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if raw.get("source_id") != SOURCE_ID or raw.get("neuronal_dynamics") != "NOT_IMPLEMENTED":
        raise FirstBrainError("UNEXPECTED_GRAPH")
    stored = raw.pop("graph_sha256")
    digest = _sha(b"BUILDWITHAAI_MB_GRAPH_V1\0", raw)
    if stored != GRAPH_SHA256 or digest != GRAPH_SHA256:
        raise FirstBrainError("GRAPH_HASH_MISMATCH")
    ids = tuple(raw["selected_ids"])
    if len(ids) != 128 or len(set(ids)) != 128:
        raise FirstBrainError("GRAPH_NODE_COUNT")
    index = {node: i for i, node in enumerate(ids)}
    edges = []
    for pre, post, weight in raw["edges"]:
        if pre not in index or post not in index or type(weight) is not int or weight < 1:
            raise FirstBrainError("GRAPH_EDGE")
        edges.append((index[pre], index[post], weight))
    return {"ids": ids, "edges": tuple(edges), "graph_sha256": stored}


def degree_preserving_rewire(edges: tuple, seed: int) -> tuple:
    """Same directed out-stubs, shuffled targets. Edge count is unchanged."""
    rng = random.Random(seed)
    grouped: dict[int, list[tuple[int, int]]] = {}
    for pre, post, weight in edges:
        grouped.setdefault(pre, []).append((post, weight))
    donors = [(pre, post, weight) for pre, stubs in grouped.items() for post, weight in stubs]
    targets = [post for _, post, _ in donors]
    rng.shuffle(targets)
    rewired = tuple(sorted((pre, targets[i], weight) for i, (pre, _, weight) in enumerate(donors)))
    if len(rewired) != len(edges):
        raise FirstBrainError("NULL_EDGE_COUNT")
    return rewired


def _tanh(value: float) -> float:
    if value > 20:
        return 1.0
    if value < -20:
        return -1.0
    return math.tanh(value)


def _forward(edges, gains, readout, features: tuple[float, float, float, float]) -> float:
    n = 128
    state = [0.0] * n
    for _ in range(STEPS):
        drive = [0.0] * n
        for pre, post, weight in edges:
            drive[post] += weight * gains[pre] * state[pre]
        scale = [0.0] * n
        for _, post, weight in edges:
            scale[post] += weight
        nxt = []
        for i in range(n):
            incoming = drive[i] / scale[i] if scale[i] else 0.0
            external = 0.0
            if i < INPUT_COUNT:
                external = (1 if i % 2 == 0 else -1) * features[i % 4]
            nxt.append(_tanh(DECAY * state[i] + incoming + external))
        state = nxt
    logit = readout[-1]
    for k, neuron in enumerate(range(n - OUTPUT_COUNT, n)):
        logit += readout[k] * state[neuron]
    return 1 / (1 + math.exp(-max(-20, min(20, logit))))


def _loss(edges, gains, readout, rows) -> float:
    total = 0.0
    for features, label in rows:
        p = min(1 - 1e-6, max(1e-6, _forward(edges, gains, readout, features)))
        total += -(label * math.log(p) + (1 - label) * math.log(1 - p))
    return total / len(rows)


def train(edges, rows, seed: int, steps: int = 40) -> dict:
    """Deterministic coordinate descent. Seed is part of the model identity, not a hidden shuffle."""
    if not rows:
        raise FirstBrainError("EMPTY_TRAIN")
    gains = [0.05] * 128
    readout = [0.0] * (OUTPUT_COUNT + 1)
    for step in range(steps):
        base = _loss(edges, gains, readout, rows)
        for delta in (-0.05, 0.05):
            trial = readout[:]
            trial[-1] = max(-2.0, min(2.0, trial[-1] + delta))
            if _loss(edges, gains, trial, rows) < base:
                readout = trial
                base = _loss(edges, gains, readout, rows)
                break
        neuron = step % 128
        for delta in (0.05, -0.05):
            trial_g = gains[:]
            trial_g[neuron] = max(-1.0, min(1.0, trial_g[neuron] + delta))
            if _loss(edges, trial_g, readout, rows) < base:
                gains = trial_g
                break
    model = {
        "gains": [round(g, 5) for g in gains],
        "readout": [round(r, 5) for r in readout],
        "seed": seed,
        "steps": steps,
        "optimizer": "bias_then_cyclic_gain_v1",
    }
    model["model_sha256"] = _sha(b"BUILDWITHAAI_FIRST_BRAIN_MODEL_V1\0", model)
    return model


def choose_abstain_band(edges, model, rows) -> int:
    """Return uncertainty half-width in ppm. Inside the band the brain abstains."""
    if not rows:
        return 500_000
    wrong_near = []
    for features, label in rows:
        p = _forward(edges, model["gains"], model["readout"], features)
        margin = abs(p - 0.5)
        if int(p >= 0.5) != label:
            wrong_near.append(margin)
    if not wrong_near:
        return 0
    wrong_near.sort()
    return int(wrong_near[len(wrong_near) // 2] * 1_000_000)


def receipt(edges, model, features, band_ppm: int, graph_sha256: str) -> dict:
    probability = _forward(edges, model["gains"], model["readout"], features)
    uncertainty = int(abs(probability - 0.5) * 1_000_000)
    task_sha = _sha(b"BUILDWITHAAI_FIRST_BRAIN_TASK_V1\0", TASK)
    body = {
        "module_id": MODULE_ID,
        "source_id": SOURCE_ID,
        "graph_sha256": graph_sha256,
        "model_sha256": model["model_sha256"],
        "task_sha256": task_sha,
        "horizon_ms": HORIZON_MS,
        "action": "NO_EXECUTION",
        "execution_allowed": False,
    }
    if uncertainty < band_ppm:
        body["prediction_ppm"] = None
        body["uncertainty_ppm"] = None
        body["abstain_reason"] = "UNCALIBRATED"
    else:
        body["prediction_ppm"] = int(probability * 1_000_000)
        body["uncertainty_ppm"] = uncertainty
        body["abstain_reason"] = None
    return body


def run_self_check(graph_path: Path) -> dict:
    graph = load_graph(graph_path)
    rng = random.Random(7)
    rows = []
    for _ in range(48):
        features = tuple(rng.uniform(-1, 1) for _ in range(4))
        label = 1 if features[0] < -0.2 else 0
        rows.append((features, label))
    train_rows, val_rows, test_rows = rows[:24], rows[24:36], rows[36:]
    real = train(graph["edges"], train_rows, seed=7, steps=30)
    again = train(graph["edges"], train_rows, seed=7, steps=30)
    if real["model_sha256"] != again["model_sha256"]:
        raise FirstBrainError("NOT_DETERMINISTIC")
    null_edges = degree_preserving_rewire(graph["edges"], seed=11)
    out_real = sorted(pre for pre, _, _ in graph["edges"])
    out_null = sorted(pre for pre, _, _ in null_edges)
    if out_real != out_null or len(null_edges) != len(graph["edges"]):
        raise FirstBrainError("NULL_DEGREE")
    band = choose_abstain_band(graph["edges"], real, val_rows)
    sample = receipt(graph["edges"], real, test_rows[0][0], band, graph["graph_sha256"])
    if sample["action"] != "NO_EXECUTION" or sample["execution_allowed"] is not False:
        raise FirstBrainError("EXECUTION_LEAK")
    return {
        "classification": "SYNTHETIC_SELF_CHECK",
        "graph_sha256": graph["graph_sha256"],
        "edges": len(graph["edges"]),
        "model_sha256": real["model_sha256"],
        "train_loss": round(_loss(graph["edges"], real["gains"], real["readout"], train_rows), 4),
        "abstain_band_ppm": band,
        "sample_abstained": sample["abstain_reason"] == "UNCALIBRATED",
        "market_skill": "NOT_ESTABLISHED",
        "action": "NO_EXECUTION",
    }


if __name__ == "__main__":
    here = Path(__file__).resolve()
    candidates = [here.parent / "hemibrain_v1_2_first128.json"]
    if len(here.parents) > 2:
        candidates.insert(0, here.parents[2] / "research/brain-assets/hemibrain_v1_2_first128.json")
    graph_path = next(path for path in candidates if path.is_file())
    print(json.dumps(run_self_check(graph_path), sort_keys=True))
