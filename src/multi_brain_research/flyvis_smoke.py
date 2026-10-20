"""Bounded, independent verification of FV-SMOKE-001 output; no ML imports."""

from __future__ import annotations

import array
import ast
import hashlib
import json
import math
import re
import struct
import sys
from pathlib import Path


EXPERIMENT_ID = "FV-SMOKE-001"
REGISTRATION_SHA256 = "a1c49e607b97f338aabe735f3dc5143100f1d6b42a0f06c05bb30f40f339c031"
UPSTREAM_COMMIT = "0a69fa2fc8e1bfe1d837d722c252ab5f5d6fcbfa"
CONNECTOME_SHA256 = "bfbb0766251ff09e22723d0ebbf7b14793e70b3ae8ad0eea64eac9d28223351a"
LOCK_SHA256 = "fd1666afc1db5a1b63de2127e020cd8961d9346b12a4a2ffb98db3affe4c0bd5"
MAX_OUTPUT_BYTES = 4_000_000
FILES = ("run-1.npy", "run-2.npy", "nodes.json", "report.json")
INPUT_TYPES = frozenset(f"R{i}" for i in range(1, 9))


class SmokeVerificationError(ValueError):
    """The record cannot establish the registered technical result."""


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise SmokeVerificationError(message)


def _json(data: bytes):
    def pairs(items):
        result = {}
        for key, value in items:
            _require(key not in result, "duplicate JSON key")
            result[key] = value
        return result

    def constant(_):
        raise SmokeVerificationError("non-finite JSON constant")

    try:
        return json.loads(data, object_pairs_hook=pairs, parse_constant=constant)
    except (UnicodeError, json.JSONDecodeError, RecursionError) as exc:
        raise SmokeVerificationError("invalid JSON") from exc


def load_registration(path: Path) -> dict:
    data = path.read_bytes()
    _require(sha256(data) == REGISTRATION_SHA256, "registration differs from frozen FV-SMOKE-001")
    return _json(data)


def read_activity(data: bytes) -> tuple[tuple[int, int, int], array.array]:
    """Read a small, C-order float32 NPY v1/v2 array without NumPy or pickle."""
    _require(len(data) <= MAX_OUTPUT_BYTES, "activity artifact too large")
    _require(data[:6] == b"\x93NUMPY", "invalid NPY signature")
    version = data[6:8]
    if version == b"\x01\x00":
        offset, length_format = 10, "<H"
    elif version == b"\x02\x00":
        offset, length_format = 12, "<I"
    else:
        raise SmokeVerificationError("unsupported NPY version")
    _require(len(data) >= offset, "truncated NPY header")
    header_size = struct.unpack(length_format, data[8:offset])[0]
    _require(0 < header_size <= 4096, "NPY header size outside bound")
    end = offset + header_size
    _require(end <= len(data), "truncated NPY header")
    try:
        header = ast.literal_eval(data[offset:end].decode("ascii").strip())
    except (ValueError, SyntaxError, UnicodeError, RecursionError) as exc:
        raise SmokeVerificationError("invalid NPY header") from exc
    _require(isinstance(header, dict), "NPY header must be a dictionary")
    _require(set(header) == {"descr", "fortran_order", "shape"}, "unexpected NPY metadata")
    _require(header["descr"] == "<f4", "only little-endian float32 is allowed")
    _require(header["fortran_order"] is False, "only C-order arrays are allowed")
    shape = header["shape"]
    _require(isinstance(shape, tuple) and len(shape) == 3, "invalid activity dimensions")
    _require(all(type(n) is int and n > 0 for n in shape), "invalid activity shape")
    _require(shape[:2] == (3, 40) and shape[2] <= 5000, "activity shape exceeds registration")
    elements = math.prod(shape)
    _require(elements <= 600_000, "too many activity elements")
    _require(len(data) - end == elements * 4, "activity payload length mismatch")
    values = array.array("f")
    _require(values.itemsize == 4, "platform float size unsupported")
    values.frombytes(data[end:])
    if sys.byteorder != "little":
        values.byteswap()
    _require(all(math.isfinite(v) for v in values), "non-finite activity")
    return shape, values


def evaluate_arrays(first: bytes, second: bytes, node_types: list[str]) -> dict:
    shape, a = read_activity(first)
    other_shape, b = read_activity(second)
    _require(shape == other_shape, "repeat shape mismatch")
    _require(isinstance(node_types, list) and len(node_types) == shape[2], "node metadata mismatch")
    _require(all(isinstance(t, str) and 0 < len(t) <= 32 for t in node_types), "invalid node types")
    _require(INPUT_TYPES <= set(node_types), "photoreceptor types missing")
    downstream = [i for i, t in enumerate(node_types) if t not in INPUT_TYPES]
    _require(bool(downstream), "no non-input neurons")
    repeat_delta = max(abs(x - y) for x, y in zip(a, b))
    width, frames = shape[2], shape[1]
    flash_deltas = [
        max(
            abs(a[(condition * frames + frame) * width + node] - a[frame * width + node])
            for frame in range(frames)
            for node in downstream
        )
        for condition in (1, 2)
    ]
    passed = repeat_delta <= 1e-6 and max(flash_deltas) > 1e-7
    return {
        "status": "PASS_TECHNICAL_ONLY" if passed else "REJECT_TECHNICAL_HYPOTHESIS",
        "shape": list(shape),
        "finite_activity_fraction": 1.0,
        "repeat_max_absolute_difference": repeat_delta,
        "non_input_flash_max_absolute_difference_from_gray": flash_deltas,
        "non_input_neurons": len(downstream),
    }


def verify_run(directory: Path, registration: Path) -> dict:
    """Recompute numerical criteria from fixed, bounded output files.

    This establishes artifact consistency, not a signed execution attestation.
    """
    load_registration(registration)
    _require(directory.is_dir() and not directory.is_symlink(), "run directory unavailable")
    data = {}
    total = 0
    for name in FILES:
        path = directory / name
        _require(path.is_file() and not path.is_symlink(), "missing or linked output artifact")
        size = path.stat().st_size
        total += size
        _require(0 < size <= MAX_OUTPUT_BYTES and total <= MAX_OUTPUT_BYTES, "output budget exceeded")
        content = path.read_bytes()
        _require(len(content) == size, "artifact changed while reading")
        data[name] = content
    nodes, report = _json(data["nodes.json"]), _json(data["report.json"])
    _require(isinstance(nodes, dict) and set(nodes) == {"node_types"}, "invalid node metadata")
    _require(isinstance(report, dict), "invalid run report")
    expected = {
        "experiment_id": EXPERIMENT_ID,
        "registration_sha256": REGISTRATION_SHA256,
        "upstream_commit": UPSTREAM_COMMIT,
        "connectome_sha256": CONNECTOME_SHA256,
        "dependency_lock_sha256": LOCK_SHA256,
        "device": "cpu",
        "weights": "UNTRAINED_UPSTREAM_INITIALIZATION",
        "checkpoint_loading_allowed": False,
        "biological_replication_established": False,
        "market_validation_established": False,
        "live_execution_allowed": False,
        "conditions": ["gray", "on_flash", "off_flash"],
    }
    for key, value in expected.items():
        _require(type(report.get(key)) is type(value) and report[key] == value, f"invalid {key}")
    for key in ("integration_commit",):
        _require(isinstance(report.get(key), str) and re.fullmatch(r"[0-9a-f]{40}", report[key]) is not None, f"invalid {key}")
    for key in ("worker_sha256", "verifier_sha256", "model_state_sha256"):
        _require(isinstance(report.get(key), str) and re.fullmatch(r"[0-9a-f]{64}", report[key]) is not None, f"invalid {key}")
    _require(type(report.get("torch_threads")) is int and report["torch_threads"] == 1, "thread budget mismatch")
    elapsed = report.get("wall_time_seconds")
    _require(type(elapsed) in (int, float) and math.isfinite(elapsed) and 0 < elapsed <= 180, "runtime exceeds registration")
    _require(type(report.get("edges")) is int and 0 < report["edges"] <= 1_000_000, "edge budget mismatch")
    hashes = report.get("artifact_sha256")
    _require(isinstance(hashes, dict), "artifact hashes missing")
    for name in FILES[:-1]:
        _require(hashes.get(name) == sha256(data[name]), f"artifact digest mismatch: {name}")
    metrics = evaluate_arrays(data["run-1.npy"], data["run-2.npy"], nodes["node_types"])
    _require(type(report.get("nodes")) is int and report["nodes"] == metrics["shape"][2], "node count mismatch")
    _require(report.get("status") == metrics["status"], "reported status differs from numerical evidence")
    _require(json.dumps(report.get("metrics"), sort_keys=True) == json.dumps(metrics, sort_keys=True), "reported metrics differ from numerical evidence")
    return {
        **metrics,
        "experiment_id": EXPERIMENT_ID,
        "report_sha256": sha256(data["report.json"]),
        "output_bytes": total,
        "execution_attestation": "NOT_ESTABLISHED",
        "biological_replication_established": False,
        "market_validation_established": False,
        "live_execution_allowed": False,
    }
