"""Adversarial reference checks with synthetic fixtures, never pretrained-model execution."""

import array
import io
import json
import math
import stat
import struct
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from multi_brain_research.flyvis_reference import (
    CONNECTOME_SHA256, EXPERIMENT_ID, LOCK_SHA256, REGISTRATION_SHA256, UPSTREAM_COMMIT,
    ReferenceVerificationError, bounded_file, evaluate_arrays, independent_fri,
    load_registration, selected_members, sha256, verify_run,
)

ROOT = Path(__file__).resolve().parents[1]
REGISTRATION = ROOT / "experiments/flyvis_trained_reference/registration.json"
REG = load_registration(REGISTRATION)
LABELS = REG["network"]["labels"]


def npy(values, shape=(4, 600, 65), descr="<f4"):
    header = repr({"descr": descr, "fortran_order": False, "shape": shape}).encode("ascii")
    header += b" " * ((-len(header) - 11) % 16) + b"\n"
    content = array.array("f", values)
    if sys.byteorder != "little":
        content.byteswap()
    return b"\x93NUMPY\x01\x00" + struct.pack("<H", len(header)) + header + content.tobytes()


def responses(correct=24):
    values = array.array("f", [0.5]) * (4 * 600 * 65)
    for i, (label, expected) in enumerate(REG["biological_reference"]["non_input_polarity"].items()):
        preferred = expected if i < correct else -expected
        sample = 3 if preferred > 0 else 1
        values[(sample * 600 + 200) * 65 + LABELS.index(label)] = 2.0
    return values


def write_run(directory, correct=24):
    values = responses(correct)
    data = npy(values)
    for name in ("run-1.npy", "run-2.npy"):
        (directory / name).write_bytes(data)
    (directory / "cells.json").write_text(json.dumps({"labels": LABELS, "central_indices": list(range(65))}))
    upstream = independent_fri(values)
    metrics = evaluate_arrays(data, data, LABELS, upstream, REG)
    report = {
        "experiment_id": EXPERIMENT_ID, "registration_sha256": REGISTRATION_SHA256,
        "upstream_commit": UPSTREAM_COMMIT, "connectome_sha256": CONNECTOME_SHA256,
        "dependency_lock_sha256": LOCK_SHA256, "archive_sha256": REG["archive"]["sha256"],
        "license_sha256": REG["license"]["sha256"], "checkpoint_sha256": REG["model_member_sha256"],
        "config_sha256": REG["config_member_sha256"], "selected_model": "000", "device": "cpu",
        "torch_threads": 1, "weights_only": True, "strict_state_dict": True,
        "nodes": 45669, "edges": 1513231, "parameters_including_fixed": 3693,
        "learned_parameters": 734, "repeats_completed": 2, "training_performed": False,
        "full_paper_replication_established": False, "market_validation_established": False,
        "live_execution_allowed": False, "integration_commit": "a" * 40,
        "worker_sha256": "b" * 64, "verifier_sha256": "c" * 64,
        "raw_network_state_sha256": "d" * 64, "inference_state_sha256": "e" * 64,
        "wall_time_seconds": 1.0, "peak_rss_mib": 500.0, "cpu_time_seconds": 1.0,
        "upstream_fri": upstream, "metrics": metrics, "status": metrics["status"],
        "artifact_sha256": {name: sha256((directory / name).read_bytes())
                            for name in ("run-1.npy", "run-2.npy", "cells.json")},
    }
    (directory / "report.json").write_text(json.dumps(report))
    return report


class ReferenceTests(unittest.TestCase):
    def test_registration_and_retained_mit_notice(self):
        self.assertEqual(REG["experiment_id"], "FV-REF-001")
        notice = ROOT / "experiments/flyvis_trained_reference/LICENSE-model-assets.txt"
        bounded_file(notice, REG["license"]["bytes"], REG["license"]["sha256"])

    def test_boundary_is_18_of_24(self):
        for correct in (0, 14, 17, 18, 24):
            with self.subTest(correct=correct):
                values = responses(correct)
                data = npy(values)
                result = evaluate_arrays(data, data, LABELS, independent_fri(values), REG)
                self.assertEqual(result["known_non_input_correct"], correct)
                self.assertEqual(result["status"], "PASS_SCOPED_REFERENCE_CHECK" if correct >= 18
                                 else "REJECT_SCOPED_HYPOTHESIS")

    def test_positive_minimum_shift_and_inclusive_final_frame(self):
        values = array.array("f", [1.0]) * (4 * 600 * 65)
        # Earlier frame 199 is excluded, frame 400 included, 401 excluded.
        values[(3 * 600 + 199) * 65] = 100
        values[(3 * 600 + 400) * 65] = 3
        values[(1 * 600 + 401) * 65] = 200
        self.assertAlmostEqual(independent_fri(values)[0], 1 / 3, places=7)

    def test_raw_repeat_and_upstream_disagreement_reject(self):
        a = responses()
        b = array.array("f", a)
        b[0] += 0.01
        upstream = independent_fri(a)
        self.assertEqual(evaluate_arrays(npy(a), npy(b), LABELS, upstream, REG)["status"],
                         "REJECT_SCOPED_HYPOTHESIS")
        upstream[0] += 0.1
        self.assertEqual(evaluate_arrays(npy(a), npy(a), LABELS, upstream, REG)["status"],
                         "REJECT_SCOPED_HYPOTHESIS")

    def test_silent_array_does_not_satisfy_biological_reference(self):
        data = npy([0.0] * (4 * 600 * 65))
        result = evaluate_arrays(data, data, LABELS, [0.0] * 65, REG)
        self.assertEqual(result["known_non_input_correct"], 0)
        self.assertEqual(result["status"], "REJECT_SCOPED_HYPOTHESIS")

    def test_wrong_cell_order_and_nonfinite_upstream_refused(self):
        values = responses()
        data = npy(values)
        for labels, upstream in ((LABELS[::-1], independent_fri(values)), (LABELS, [math.nan] * 65)):
            with self.assertRaises(ReferenceVerificationError):
                evaluate_arrays(data, data, labels, upstream, REG)

    def test_npy_object_shape_nonfinite_and_truncation_refused(self):
        values = responses()
        bad = array.array("f", values)
        bad[0] = math.inf
        for content in (npy(values, descr="|O"), npy([], shape=(4, 600, 999999999)),
                        npy(bad), npy(values)[:-1]):
            with self.assertRaises(ReferenceVerificationError):
                evaluate_arrays(content, npy(values), LABELS, independent_fri(values), REG)

    def test_complete_evidence_verified_with_no_ml_import(self):
        with tempfile.TemporaryDirectory() as name:
            directory = Path(name)
            write_run(directory)
            result = verify_run(directory, REGISTRATION)
            self.assertEqual(result["known_non_input_correct"], 24)
            self.assertFalse(result["live_execution_allowed"])
            self.assertEqual(result["execution_attestation"], "NOT_ESTABLISHED")

    def test_provenance_promotions_and_resource_forgery_refused(self):
        for key, value in (("selected_model", "001"), ("weights_only", False),
                           ("strict_state_dict", False), ("full_paper_replication_established", True),
                           ("live_execution_allowed", 0), ("repeats_completed", 1),
                           ("nodes", 45668), ("learned_parameters", 735),
                           ("wall_time_seconds", 901), ("peak_rss_mib", 6145),
                           ("cpu_time_seconds", math.inf), ("checkpoint_sha256", "a" * 64)):
            with tempfile.TemporaryDirectory() as name, self.subTest(key=key):
                directory = Path(name)
                report = write_run(directory)
                report[key] = value
                (directory / "report.json").write_text(json.dumps(report))
                with self.assertRaises(ReferenceVerificationError):
                    verify_run(directory, REGISTRATION)

    def test_rehashed_tampering_and_forged_success_refused(self):
        for tamper in ("array", "metrics", "success"):
            with tempfile.TemporaryDirectory() as name, self.subTest(tamper=tamper):
                directory = Path(name)
                report = write_run(directory, correct=17)
                if tamper == "array":
                    values = responses()
                    values[0] = math.nan
                    (directory / "run-1.npy").write_bytes(npy(values))
                    report["artifact_sha256"]["run-1.npy"] = sha256(npy(values))
                elif tamper == "metrics":
                    report["metrics"]["known_non_input_correct"] = 24
                else:
                    report["status"] = "PASS_SCOPED_REFERENCE_CHECK"
                (directory / "report.json").write_text(json.dumps(report))
                with self.assertRaises(ReferenceVerificationError):
                    verify_run(directory, REGISTRATION)

    def test_failed_result_makes_cli_fail(self):
        with tempfile.TemporaryDirectory() as name:
            write_run(Path(name), correct=17)
            result = subprocess.run([sys.executable, str(ROOT / "scripts/verify_flyvis_reference.py"), name],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(json.loads(result.stdout)["status"], "REJECT_SCOPED_HYPOTHESIS")

    def test_archive_path_symlink_duplicate_and_expansion_refused(self):
        for kind in ("../escape", "/absolute", "a\\b", "C:bad", "symlink", "duplicate", "expansion"):
            stream = io.BytesIO()
            with zipfile.ZipFile(stream, "w") as archive:
                if kind == "symlink":
                    info = zipfile.ZipInfo("link")
                    info.create_system = 3
                    info.external_attr = (stat.S_IFLNK | 0o777) << 16
                    archive.writestr(info, "target")
                elif kind == "duplicate":
                    archive.writestr("a", "x")
                    archive.writestr("a", "y")
                elif kind == "expansion":
                    archive.writestr("big", b"x" * 100001)
                else:
                    archive.writestr(kind, "x")
            with self.subTest(kind=kind), self.assertRaises(ReferenceVerificationError):
                selected_members(stream.getvalue(), REG)

    def test_asset_digest_and_changed_registration_refused(self):
        with tempfile.TemporaryDirectory() as name:
            path = Path(name) / "asset"
            path.write_bytes(b"wrong")
            with self.assertRaises(ReferenceVerificationError):
                bounded_file(path, 5, "a" * 64)
            path.write_bytes(REGISTRATION.read_bytes() + b"\n")
            with self.assertRaises(ReferenceVerificationError):
                load_registration(path)


if __name__ == "__main__":
    unittest.main()
