"""Adversarial artifact checks; these tests never import an ML framework."""

import array
import json
import math
import struct
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from multi_brain_research.flyvis_smoke import (
    CONNECTOME_SHA256,
    EXPERIMENT_ID,
    INPUT_TYPES,
    LOCK_SHA256,
    REGISTRATION_SHA256,
    UPSTREAM_COMMIT,
    SmokeVerificationError,
    evaluate_arrays,
    load_registration,
    read_activity,
    sha256,
    verify_run,
)

REGISTRATION = Path(__file__).resolve().parents[1] / "experiments/flyvis_cpu_smoke/registration.json"


def npy(values, shape=(3, 40, 10), descr="<f4"):
    header = repr({"descr": descr, "fortran_order": False, "shape": shape}).encode("ascii")
    header += b" " * ((-len(header) - 11) % 16) + b"\n"
    data = array.array("f", values)
    if sys.byteorder != "little":
        data.byteswap()
    return b"\x93NUMPY\x01\x00" + struct.pack("<H", len(header)) + header + data.tobytes()


def response():
    values = [0.0] * 1200
    values[400 + 10 * 10 + 8] = 0.25
    values[800 + 10 * 10 + 8] = -0.25
    return values


NODE_TYPES = sorted(INPUT_TYPES) + ["L1", "T4a"]


def write_run(directory, values=None):
    content = npy(response() if values is None else values)
    (directory / "run-1.npy").write_bytes(content)
    (directory / "run-2.npy").write_bytes(content)
    (directory / "nodes.json").write_text(json.dumps({"node_types": NODE_TYPES}))
    metrics = evaluate_arrays(content, content, NODE_TYPES)
    report = {
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
        "metrics": metrics,
        "status": metrics["status"],
        "artifact_sha256": {name: sha256((directory / name).read_bytes()) for name in ("run-1.npy", "run-2.npy", "nodes.json")},
    }
    (directory / "report.json").write_text(json.dumps(report))
    return report


class FlyvisArtifactTests(unittest.TestCase):
    def test_frozen_registration(self):
        self.assertEqual(load_registration(REGISTRATION)["experiment_id"], EXPERIMENT_ID)

    def test_finite_reproducible_stimulus_propagation(self):
        content = npy(response())
        result = evaluate_arrays(content, content, NODE_TYPES)
        self.assertEqual(result["status"], "PASS_TECHNICAL_ONLY")
        self.assertEqual(result["repeat_max_absolute_difference"], 0)
        self.assertEqual(result["non_input_flash_max_absolute_difference_from_gray"], [0.25, 0.25])

    def test_silent_network_cannot_pass(self):
        content = npy([0.0] * 1200)
        self.assertEqual(evaluate_arrays(content, content, NODE_TYPES)["status"], "REJECT_TECHNICAL_HYPOTHESIS")

    def test_input_only_response_cannot_pass(self):
        values = [0.0] * 1200
        values[400] = 1
        content = npy(values)
        self.assertEqual(evaluate_arrays(content, content, NODE_TYPES)["status"], "REJECT_TECHNICAL_HYPOTHESIS")

    def test_nonrepeatable_network_cannot_pass(self):
        a, b = response(), response()
        b[900] += 0.01
        self.assertEqual(evaluate_arrays(npy(a), npy(b), NODE_TYPES)["status"], "REJECT_TECHNICAL_HYPOTHESIS")

    def test_nonfinite_truncated_and_object_arrays_rejected(self):
        values = response()
        values[0] = math.nan
        for content in [npy(values), npy(response())[:-1], npy(response(), descr="|O")]:
            with self.subTest(kind=content[:90]), self.assertRaises(SmokeVerificationError):
                read_activity(content)

    def test_huge_shape_and_header_rejected(self):
        for content in [npy([], shape=(3, 40, 100000000)), b"\x93NUMPY\x01\x00\xff\xff"]:
            with self.assertRaises(SmokeVerificationError):
                read_activity(content)

    def test_valid_artifacts_verified_without_numpy(self):
        with tempfile.TemporaryDirectory() as name:
            directory = Path(name)
            write_run(directory)
            verified = verify_run(directory, REGISTRATION)
            self.assertEqual(verified["status"], "PASS_TECHNICAL_ONLY")
            self.assertFalse(verified["live_execution_allowed"])
            self.assertEqual(verified["execution_attestation"], "NOT_ESTABLISHED")

    def test_promoted_or_wrong_provenance_report_rejected(self):
        for key, value in [("live_execution_allowed", True), ("live_execution_allowed", 0), ("biological_replication_established", True), ("upstream_commit", "0" * 40), ("conditions", ["on_flash", "gray", "off_flash"])]:
            with tempfile.TemporaryDirectory() as name, self.subTest(key=key, value=value):
                directory = Path(name)
                report = write_run(directory)
                report[key] = value
                (directory / "report.json").write_text(json.dumps(report))
                with self.assertRaises(SmokeVerificationError):
                    verify_run(directory, REGISTRATION)

    def test_tampered_array_recomputed_digest_still_rejected(self):
        with tempfile.TemporaryDirectory() as name:
            directory = Path(name)
            report = write_run(directory)
            values = response()
            values[0] = math.inf
            altered = npy(values)
            (directory / "run-1.npy").write_bytes(altered)
            report["artifact_sha256"]["run-1.npy"] = sha256(altered)
            (directory / "report.json").write_text(json.dumps(report))
            with self.assertRaises(SmokeVerificationError):
                verify_run(directory, REGISTRATION)

    def test_forged_success_cannot_override_failed_metrics(self):
        with tempfile.TemporaryDirectory() as name:
            directory = Path(name)
            report = write_run(directory, [0.0] * 1200)
            report["status"] = "PASS_TECHNICAL_ONLY"
            (directory / "report.json").write_text(json.dumps(report))
            with self.assertRaises(SmokeVerificationError):
                verify_run(directory, REGISTRATION)

    def test_duplicate_keys_and_changed_registration_rejected(self):
        with tempfile.TemporaryDirectory() as name:
            directory = Path(name)
            write_run(directory)
            (directory / "nodes.json").write_text('{"node_types":[],"node_types":[]}')
            with self.assertRaises(SmokeVerificationError):
                verify_run(directory, REGISTRATION)
            changed = directory / "registration.json"
            changed.write_bytes(REGISTRATION.read_bytes() + b"\n")
            with self.assertRaises(SmokeVerificationError):
                load_registration(changed)


if __name__ == "__main__":
    unittest.main()
