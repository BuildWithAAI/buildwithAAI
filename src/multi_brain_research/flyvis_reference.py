"""Bounded acquisition and independent FV-REF-001 verification; standard library only."""

from __future__ import annotations

import io
import json
import math
import re
import stat
import struct
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

from .flyvis_smoke import (
    CONNECTOME_SHA256, LOCK_SHA256, UPSTREAM_COMMIT,
    SmokeVerificationError as ReferenceVerificationError,
    _json, _require, read_activity, sha256,
)

EXPERIMENT_ID = "FV-REF-001"
REGISTRATION_SHA256 = "874a1487de5288b2a99769c0b3eb841040147e885519cc50715f3f7f42e1309f"
FILES = ("run-1.npy", "run-2.npy", "cells.json", "report.json")
MAX_OUTPUT_BYTES = 4_000_000


def load_registration(path: Path) -> dict:
    data = path.read_bytes()
    _require(sha256(data) == REGISTRATION_SHA256, "registration differs from frozen FV-REF-001")
    return _json(data)


def bounded_file(path: Path, size: int, digest: str) -> bytes:
    _require(path.is_file() and not path.is_symlink(), "asset missing or linked")
    _require(path.stat().st_size == size, "asset size mismatch")
    with path.open("rb") as stream:
        data = stream.read(size + 1)
    _require(len(data) == size and sha256(data) == digest, "asset checksum mismatch")
    return data


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ReferenceVerificationError("asset download redirect refused")


def download_assets(destination: Path, registration: dict) -> tuple[Path, Path]:
    """Fetch only registered public files; no API key, cookies or user credentials."""
    destination.mkdir(parents=True, exist_ok=False)
    paths = []
    opener = urllib.request.build_opener(_NoRedirect)
    for name, spec in (("results_pretrained_models.zip", registration["archive"]),
                       ("LICENSE-model-assets.txt", registration["license"])):
        url = ("https://drive.usercontent.google.com/download?id=" + spec["file_id"]
               + "&export=download&confirm=t")
        with opener.open(url, timeout=60) as response:
            _require(response.status == 200, "asset download failed")
            data = response.read(spec["bytes"] + 1)
        _require(len(data) == spec["bytes"] and sha256(data) == spec["sha256"],
                 "download checksum or size mismatch")
        path = destination / name
        with path.open("xb") as stream:
            stream.write(data)
        paths.append(path)
    return tuple(paths)


def selected_members(data: bytes, registration: dict) -> dict[str, bytes]:
    """Validate every ZIP member; read only the two registered members, never extract."""
    result, names, total = {}, set(), 0
    wanted = {registration["model_member"]: registration["model_member_sha256"],
              registration["config_member"]: registration["config_member_sha256"]}
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            members = archive.infolist()
            _require(len(members) <= 500, "too many archive members")
            for member in members:
                name = member.filename
                parts = PurePosixPath(name).parts
                _require(name not in names, "duplicate archive member")
                names.add(name)
                _require(not name.startswith("/") and "\\" not in name and ":" not in name
                         and ".." not in parts and "\x00" not in name, "unsafe archive path")
                _require(not stat.S_ISLNK(member.external_attr >> 16), "archive symlink refused")
                _require(not member.flag_bits & 1, "encrypted archive refused")
                total += member.file_size
                _require(total <= 10_000_000 and member.file_size <= 100_000,
                         "archive expansion exceeds registered bound")
                if name in wanted:
                    value = archive.read(member)
                    _require(sha256(value) == wanted[name], "selected member checksum mismatch")
                    result[name] = value
    except (zipfile.BadZipFile, RuntimeError, OSError) as exc:
        raise ReferenceVerificationError("invalid model archive") from exc
    _require(set(result) == set(wanted), "registered model members missing")
    return result


def verify_assets(archive: Path, license_path: Path, registration: dict) -> dict[str, bytes]:
    spec = registration["license"]
    bounded_file(license_path, spec["bytes"], spec["sha256"])
    spec = registration["archive"]
    return selected_members(bounded_file(archive, spec["bytes"], spec["sha256"]), registration)


def _float32(value: float) -> float:
    return struct.unpack("<f", struct.pack("<f", value))[0]


def independent_fri(values) -> list[float]:
    """Author's radius-6 FRI, including abs(minimum) shift and float32 arithmetic."""
    result = []
    for neuron in range(65):
        off = [values[(600 + frame) * 65 + neuron] for frame in range(200, 401)]
        on = [values[(1800 + frame) * 65 + neuron] for frame in range(200, 401)]
        shift = abs(min(off + on))
        on_peak = max(_float32(x + shift) for x in on)
        off_peak = max(_float32(x + shift) for x in off)
        value = _float32(_float32(on_peak - off_peak) /
                         (_float32(on_peak + off_peak) + 1e-16))
        _require(math.isfinite(value), "non-finite derived FRI")
        result.append(value)
    return result


def evaluate_arrays(first: bytes, second: bytes, labels: list[str], upstream_fri: list,
                    registration: dict) -> dict:
    shape, a = read_activity(first, shape_prefix=(4, 600), max_width=65)
    other, b = read_activity(second, shape_prefix=(4, 600), max_width=65)
    _require(shape == other == (4, 600, 65), "reference activity shape mismatch")
    _require(labels == registration["network"]["labels"], "cell ordering differs from registration")
    _require(isinstance(upstream_fri, list) and len(upstream_fri) == 65 and
             all(type(x) in (int, float) and math.isfinite(x) for x in upstream_fri),
             "invalid upstream FRI")
    fri = independent_fri(a)
    fri_delta = max(abs(x-y) for x, y in zip(fri, upstream_fri))
    repeat_delta = max(abs(x-y) for x, y in zip(a, b))
    known = registration["biological_reference"]["non_input_polarity"]
    scores = []
    for label, expected in known.items():
        value = fri[labels.index(label)]
        predicted = (value > 0) - (value < 0)
        scores.append({"label": label, "expected": expected, "predicted": predicted,
                       "fri": value, "correct": predicted == expected})
    correct = sum(x["correct"] for x in scores)
    passed = repeat_delta <= 1e-6 and fri_delta <= 1e-6 and correct >= 18
    return {
        "status": "PASS_SCOPED_REFERENCE_CHECK" if passed else "REJECT_SCOPED_HYPOTHESIS",
        "shape": list(shape), "finite_activity_fraction": 1.0,
        "repeat_max_absolute_difference": repeat_delta,
        "independent_vs_upstream_fri_max_difference": fri_delta,
        "known_non_input_correct": correct, "known_non_input_total": 24,
        "constant_majority_correct": 14, "required_correct": 18,
        "known_non_input_scores": scores, "independent_fri": fri,
    }


def verify_run(directory: Path, registration_path: Path) -> dict:
    """Recompute the result from raw central-cell arrays; not execution attestation."""
    registration = load_registration(registration_path)
    _require(directory.is_dir() and not directory.is_symlink(), "run directory unavailable")
    data, total = {}, 0
    for name in FILES:
        path = directory / name
        _require(path.is_file() and not path.is_symlink(), "output missing or linked")
        size = path.stat().st_size
        total += size
        _require(0 < size <= MAX_OUTPUT_BYTES and total <= MAX_OUTPUT_BYTES, "output budget exceeded")
        with path.open("rb") as stream:
            content = stream.read(size + 1)
        _require(len(content) == size, "output changed while reading")
        data[name] = content
    cells, report = _json(data["cells.json"]), _json(data["report.json"])
    _require(isinstance(cells, dict) and set(cells) == {"labels", "central_indices"}, "invalid cells")
    indices = cells["central_indices"]
    _require(isinstance(indices, list) and len(indices) == 65 and len(set(indices)) == 65
             and all(type(i) is int and 0 <= i < 45669 for i in indices), "invalid central indices")
    _require(isinstance(report, dict), "invalid report")
    expected = {
        "experiment_id": EXPERIMENT_ID, "registration_sha256": REGISTRATION_SHA256,
        "upstream_commit": UPSTREAM_COMMIT, "connectome_sha256": CONNECTOME_SHA256,
        "dependency_lock_sha256": LOCK_SHA256,
        "archive_sha256": registration["archive"]["sha256"],
        "license_sha256": registration["license"]["sha256"],
        "checkpoint_sha256": registration["model_member_sha256"],
        "config_sha256": registration["config_member_sha256"],
        "selected_model": "000", "device": "cpu", "torch_threads": 1,
        "weights_only": True, "strict_state_dict": True, "nodes": 45669,
        "edges": 1513231, "parameters_including_fixed": 3693,
        "learned_parameters": 734, "repeats_completed": 2,
        "training_performed": False, "full_paper_replication_established": False,
        "market_validation_established": False, "live_execution_allowed": False,
    }
    for key, value in expected.items():
        _require(type(report.get(key)) is type(value) and report[key] == value, f"invalid {key}")
    for key, length in (("integration_commit", 40), ("worker_sha256", 64),
                        ("verifier_sha256", 64), ("raw_network_state_sha256", 64),
                        ("inference_state_sha256", 64)):
        _require(isinstance(report.get(key), str) and
                 re.fullmatch("[0-9a-f]{" + str(length) + "}", report[key]) is not None, f"invalid {key}")
    for key, bound in (("wall_time_seconds", 900), ("peak_rss_mib", 6144), ("cpu_time_seconds", 850)):
        value = report.get(key)
        _require(type(value) in (int, float) and math.isfinite(value) and 0 < value <= bound,
                 f"resource claim exceeds registration: {key}")
    hashes = report.get("artifact_sha256")
    _require(isinstance(hashes, dict), "output hashes missing")
    for name in FILES[:-1]:
        _require(hashes.get(name) == sha256(data[name]), f"artifact digest mismatch: {name}")
    metrics = evaluate_arrays(data["run-1.npy"], data["run-2.npy"], cells["labels"],
                              report.get("upstream_fri"), registration)
    _require(report.get("status") == metrics["status"], "status differs from measured evidence")
    _require(json.dumps(report.get("metrics"), sort_keys=True) == json.dumps(metrics, sort_keys=True),
             "reported metrics differ from raw evidence")
    return {**metrics, "experiment_id": EXPERIMENT_ID, "report_sha256": sha256(data["report.json"]),
            "output_bytes": total, "execution_attestation": "NOT_ESTABLISHED",
            "full_paper_replication_established": False, "market_validation_established": False,
            "live_execution_allowed": False}
