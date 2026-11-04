"""Crow-inspired memory. A heuristic, not a biological model.

No crow connectome, atlas, or trained crow network is in this repository.
The module stores feature vectors the caller has already observed and, when
a later return was recorded from a subsequent price, recalls the nearest
past outcome. An empty memory abstains. It does not invent patterns.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

from .brain_input import paper_long_support

_FIELDS = ("signed_return", "flow_imbalance", "liquidity_change")
_MAX_DISTANCE = 0.6


def _vector(features: dict) -> tuple[float, float, float] | None:
    if type(features) is not dict:
        return None
    values = []
    for name in _FIELDS:
        value = features.get(name)
        if type(value) is bool or type(value) not in (int, float) or not math.isfinite(float(value)):
            return None
        values.append(float(value))
    return tuple(values)


def _load(path: Path | None) -> list[dict]:
    if path is None or not path.exists() or not path.read_text().strip():
        return []
    rows = []
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if type(row) is dict:
            rows.append(row)
    return rows


def _abstain(reason: str) -> dict:
    return {
        "paper_long_support_ppm": None,
        "uncertainty_ppm": None,
        "abstain_reason": "MISSING_DATA",
        "detail": reason,
        "heuristic": True,
        "biological_model": False,
        "action": "NO_EXECUTION",
        "execution_allowed": False,
    }


def recall(features: dict, path: Path | None = None) -> dict:
    vector = _vector(features)
    if vector is None:
        return _abstain("CROW_FEATURES_INCOMPLETE")
    ranked = []
    for row in _load(path):
        other = _vector(row.get("features") or {})
        later = row.get("later_return")
        if other is None or type(later) is bool or type(later) not in (int, float) or not math.isfinite(float(later)):
            continue
        distance = sum(abs(left - right) for left, right in zip(vector, other))
        ranked.append((distance, float(later), row.get("observation_sha256")))
    if not ranked:
        return _abstain("CROW_MEMORY_EMPTY")
    distance, later, digest = min(ranked, key=lambda item: item[0])
    if distance > _MAX_DISTANCE:
        return _abstain("CROW_NO_SIMILAR_PATTERN")
    clamped = max(-1.0, min(1.0, later))
    scored = paper_long_support({"features": {
        "signed_return": clamped,
        "flow_imbalance": None,
        "liquidity_change": None,
    }})
    return {
        "paper_long_support_ppm": scored["prediction_ppm"],
        "uncertainty_ppm": min(1_000_000, scored["uncertainty_ppm"] + int(distance * 200_000)),
        "abstain_reason": None,
        "detail": "CROW_RECALL",
        "distance": distance,
        "recalled_return": later,
        "matched_observation_sha256": digest,
        "heuristic": True,
        "biological_model": False,
        "action": "NO_EXECUTION",
        "execution_allowed": False,
    }


def remember(path: Path, record: dict) -> None:
    if type(record) is not dict or record.get("execution_allowed") is True:
        raise ValueError("PAPER_ONLY")
    features = record.get("features")
    later = record.get("later_return")
    if _vector(features) is None or type(later) is bool or type(later) not in (int, float):
        raise ValueError("CROW_MEMORY_INCOMPLETE")
    path.parent.mkdir(parents=True, exist_ok=True)
    line = {
        "mint": record.get("mint"),
        "features": {name: features[name] for name in _FIELDS},
        "later_return": float(later),
        "observation_sha256": record.get("observation_sha256"),
        "heuristic": True,
        "biological_model": False,
        "action": "NO_EXECUTION",
    }
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(line, sort_keys=True) + "\n")
