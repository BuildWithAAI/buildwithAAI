"""Synthetic replay/recovery tests; mocked RPC calls are not historical evidence."""
from copy import deepcopy
import base64
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from src.solana_research import coin_evidence as ev
from src.solana_research import source_history as history
from src.multi_brain_research import trade_fixture as fixture
from src.multi_brain_research import trade_learning as learning
from src.multi_brain_research import training_lab as lab
from src.multi_brain_research import neural_features as neural

ROOT = Path(__file__).resolve().parents[1]


def edit_result(archive, index, change):
    item = archive["records"][index]
    payload = ev.parse(ev.unbase64(item["response_base64"]))
    change(payload)
    raw = ev.canonical(payload).encode()
    item["response_base64"], item["response_sha256"] = base64.b64encode(raw).decode(), ev.sha(raw)


def split_archives():
    result = []
    for archive in fixture.archives():
        for offset in range(2):
            slot = archive["requested_start_slot"] + offset
            copy = deepcopy(archive)
            copy["requested_start_slot"] = copy["requested_end_slot"] = slot
            copy["records"] = deepcopy(archive["records"][:3] + [archive["records"][3 + offset]])
            item = copy["records"][2]
            item["request"]["params"] = [slot, slot, {"commitment": "finalized"}]
            item["request_sha256"] = ev.digest(item["request"])
            edit_result(copy, 2, lambda p, slot=slot: p.update(result=[slot]))
            result.append(copy)
    return result


def contiguous_plan(data):
    plan = fixture.plan(learning.build_dataset(fixture.archives()))
    plan["dataset_sha256"] = lab.digest(data)
    pins = [window["window_sha256"] for window in data["windows"]]
    plan["splits"] = {
        part: [e["episode_id"] for e in data["episodes"] if e["source_window_sha256"] == pin]
        for part, pin in zip(lab.PARTS, pins, strict=True)}
    return plan


class ContiguousDatasetTests(unittest.TestCase):
    def setUp(self):
        self.archives = split_archives()

    def test_stitch_restores_market_history_and_labels_across_archive_boundaries(self):
        legacy = learning.build_dataset(self.archives)
        data = learning.build_dataset(self.archives, stitch=True)
        self.assertEqual(len(legacy["episodes"]), 24)
        self.assertEqual(len(data["episodes"]), 12)
        status = learning.assessment(data)
        self.assertEqual(status["joined_archive_boundaries"], 3)
        self.assertEqual(status["cross_archive_next_transaction_pairs"], 12)
        self.assertEqual(status["candidate_next_transaction_pairs"], 372)
        self.assertEqual(status["source_window_count"], 3)
        self.assertFalse(status["training_ready"])
        self.assertFalse(status["training_performed"])
        first = data["episodes"][0]
        self.assertEqual(len(first["observations"]), 32)
        self.assertNotEqual(learning.features(first, 16), learning.features(legacy["episodes"][4], 0))

    def test_explicit_legacy_path_keeps_previous_control_hash(self):
        model, _ = learning.fit(*fixture.demo()[1:])
        known = {"linux": "582a383958ca6e5cb41308ed2dfd66d63071b983a661d95720bc488edbda535a",
                 "win32": "74a9b90433a425855ed28d7c25cf1f25d3d0d0a16d2ca14fe4d240efc50e2fdc"}
        if sys.platform not in known:
            self.skipTest("Pinned numerical baselines are retained for Linux and Windows only")
        self.assertEqual(lab.digest(model), known[sys.platform])

    def test_contiguous_repartition_preserves_full_episode_features_and_fitted_weights(self):
        data = learning.build_dataset(self.archives, stitch=True)
        original_sources, original, plan = fixture.demo()
        model, report = learning.fit(data, contiguous_plan(data))
        before, old_report = learning.fit(original, plan)
        for key in ("weights", "bias", "means", "scales"):
            self.assertEqual(model[key], before[key])
        self.assertEqual(report["metrics"], old_report["metrics"])
        self.assertEqual(len(original_sources), 3)

    def test_archive_input_order_cannot_change_stitched_dataset(self):
        self.assertEqual(learning.build_dataset(self.archives, stitch=True),
                         learning.build_dataset(list(reversed(self.archives)), stitch=True))

    def test_missing_requested_interval_starts_another_episode(self):
        data = learning.build_dataset([self.archives[0], self.archives[2]], stitch=True)
        self.assertEqual(len(data["windows"]), 2)
        self.assertEqual(learning.assessment(data)["cross_archive_next_transaction_pairs"], 0)

    def test_cross_archive_parent_hash_and_parent_slot_must_both_match(self):
        for changed in ({"previousBlockhash": fixture.address("wrong")}, {"parentSlot": 998}):
            sources = deepcopy(self.archives)
            edit_result(sources[1], 3, lambda p, changed=changed: p["result"].update(changed))
            with self.assertRaisesRegex(ev.EvidenceError, "HISTORY_BLOCK_LINKAGE_GAP"):
                learning.build_dataset(sources, stitch=True)

    def test_mint_decimal_changes_cannot_disappear_when_archives_are_joined(self):
        def change(payload):
            for transaction in payload["result"]["transactions"]:
                for field in ("preTokenBalances", "postTokenBalances"):
                    transaction["meta"][field][0]["uiTokenAmount"]["decimals"] = 7
        edit_result(self.archives[1], 3, change)
        with self.assertRaisesRegex(lab.TrainingError, "MARKET_DECIMALS_CONFLICT"):
            learning.build_dataset(self.archives, stitch=True)

    def test_contiguous_format_preserves_asset_group_isolation(self):
        for archive in self.archives[2:4]:
            def change(payload):
                for transaction in payload["result"]["transactions"]:
                    for field in ("preTokenBalances", "postTokenBalances"):
                        transaction["meta"][field][0]["mint"] = fixture.address("mint_0")
            edit_result(archive, 3, change)
        data = learning.build_dataset(self.archives, stitch=True)
        with self.assertRaisesRegex(lab.TrainingError, "ASSET_GROUP_LEAKAGE"):
            learning.validate_plan(data, contiguous_plan(data))

    def test_provider_change_cannot_be_silently_stitched(self):
        self.archives[1]["endpoint"] = ev.ENDPOINTS[1]
        with self.assertRaisesRegex(ev.EvidenceError, "HISTORY_ENDPOINT_CHANGED"):
            learning.build_dataset(self.archives, stitch=True)

    def test_skipped_slot_is_covered_and_not_interpolated(self):
        first, skipped, last = deepcopy(self.archives[0]), deepcopy(self.archives[1]), deepcopy(self.archives[1])
        skipped["records"] = skipped["records"][:3]
        edit_result(skipped, 2, lambda p: p.update(result=[]))
        last["requested_start_slot"] = last["requested_end_slot"] = 1002
        for index in (1, 2, 3):
            record = last["records"][index]
            if index == 1:
                edit_result(last, index, lambda p: p.update(result=1002))
            elif index == 2:
                record["request"]["params"] = [1002, 1002, {"commitment": "finalized"}]
                edit_result(last, index, lambda p: p.update(result=[1002]))
            else:
                record["request"]["params"][0] = 1002
                edit_result(last, index, lambda p: p["result"].update(
                    parentSlot=1000, previousBlockhash=fixture.address("block_1000"),
                    blockhash=fixture.address("block_1002")))
            record["request_sha256"] = ev.digest(record["request"])
        data = learning.build_dataset([first, skipped, last], stitch=True)
        self.assertEqual(len(data["windows"]), 1)
        self.assertEqual(data["sources"][1]["skipped_slots"], [1001])
        self.assertEqual({r["order"][0] for e in data["episodes"] for r in e["observations"]}, {1000, 1002})
        # Claiming the missing slot was skipped while its hash remains the parent fails.
        edit_result(last, 3, lambda p: p["result"].update(
            parentSlot=1001, previousBlockhash=fixture.address("block_1001")))
        with self.assertRaisesRegex(ev.EvidenceError, "HISTORY_BLOCK_LINKAGE_GAP"):
            learning.build_dataset([first, skipped, last], stitch=True)

    def test_duplicate_transaction_across_archives_cannot_inflate_training_rows(self):
        duplicate = deepcopy(ev.parse(ev.unbase64(self.archives[0]["records"][3]["response_base64"]))["result"]["transactions"][0])
        edit_result(self.archives[1], 3, lambda p: p["result"]["transactions"].append(duplicate))
        with self.assertRaisesRegex(lab.TrainingError, "DUPLICATE_SOURCE_TRANSACTION"):
            learning.build_dataset(self.archives, stitch=True)

    def test_future_archive_suffix_cannot_change_earlier_features(self):
        data = learning.build_dataset(self.archives, stitch=True)
        before = [[learning.features(e, i) for i in range(16)] for e in data["episodes"][:4]]
        def perturb(payload):
            for tx in payload["result"]["transactions"]:
                for item in tx["meta"]["innerInstructions"][0]["instructions"]:
                    raw = bytearray(ev.b58decode(item["data"]))
                    raw[72:80] = (int.from_bytes(raw[72:80], "little") * 3).to_bytes(8, "little")
                    item["data"] = ev.b58encode(raw)
        edit_result(self.archives[1], 3, perturb)
        changed = learning.build_dataset(self.archives, stitch=True)
        self.assertEqual(before, [[learning.features(e, i) for i in range(16)] for e in changed["episodes"][:4]])
        self.assertNotEqual(learning.features(data["episodes"][0], 16), learning.features(changed["episodes"][0], 16))

    def test_window_pins_assignment_gaps_and_unknown_fields_are_rejected(self):
        original = learning.build_dataset(self.archives, stitch=True)
        for mutation in ("pin", "assignment", "gap", "fields"):
            data = deepcopy(original)
            if mutation == "pin":
                data["windows"][0]["window_sha256"] = "a" * 64
            elif mutation == "assignment":
                data["windows"][0]["archive_sha256s"].append(data["windows"][0]["archive_sha256s"][0])
                data["windows"][0]["window_sha256"] = history.window_pin(data["windows"][0]["archive_sha256s"])
            elif mutation == "gap":
                data["windows"][0]["archive_sha256s"] = [data["sources"][0]["archive_sha256"], data["sources"][2]["archive_sha256"]]
                data["windows"][0]["window_sha256"] = history.window_pin(data["windows"][0]["archive_sha256s"])
            else:
                data["windows"][0]["future_outcome"] = "fixture"
            with self.assertRaises(ValueError):
                learning.validate_dataset(data)

    def test_source_limits_are_enforced_before_reconstruction(self):
        for sources in ([], self.archives * 11):
            with self.assertRaisesRegex(lab.TrainingError, "SOURCE_ARCHIVE_BOUND"):
                learning.build_dataset(sources, stitch=True)
        with patch.object(learning, "MAX_SOURCE_BYTES", 1):
            with self.assertRaisesRegex(lab.TrainingError, "SOURCE_BYTE_BOUND"):
                learning.build_dataset(self.archives, stitch=True)

    def test_windowed_package_must_reconstruct_from_all_raw_archives(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "source"
            learning.prepare(self.archives, output, stitch=True)
            _, data = learning.load_sources(output)
            self.assertEqual(data["protocol"], learning.CONTIGUOUS_DATASET)
            data["episodes"][0]["observations"][0]["last_price"]["numerator"] *= 2
            manifest = ev.read(output / "source-manifest.json")
            manifest["dataset_sha256"] = lab.digest(data)
            (output / "dataset.json").write_text(ev.canonical(data), encoding="utf-8")
            (output / "source-manifest.json").write_text(ev.canonical(manifest), encoding="utf-8")
            with self.assertRaisesRegex(lab.TrainingError, "SOURCE_DATASET_RECONSTRUCTION_MISMATCH"):
                learning.load_sources(output)

    def test_changed_window_mode_cannot_reuse_saved_dataset(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "source"
            learning.prepare(self.archives, output, stitch=True)
            manifest = ev.read(output / "source-manifest.json")
            manifest["protocol"] = "AAI_TRADE_SOURCE_PACKAGE_V1"
            (output / "source-manifest.json").write_text(ev.canonical(manifest), encoding="utf-8")
            with self.assertRaisesRegex(lab.TrainingError, "SOURCE_DATASET_RECONSTRUCTION_MISMATCH"):
                learning.load_sources(output)

    def test_contiguous_training_and_independent_readout_verification(self):
        data = learning.build_dataset(self.archives, stitch=True)
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "readout"
            result = learning.run(self.archives, contiguous_plan(data), output, stitch=True)
            self.assertEqual(result["model_sha256"], learning.verify(output)["model_sha256"])

    def test_neural_contract_accepts_contiguous_data_without_claiming_native_execution(self):
        data = learning.build_dataset(self.archives, stitch=True)
        bundle = neural.export(data, learning.PIPELINE, learning.features,
                               lambda rows: [[float(row[3])] * 57 for row in rows])
        self.assertEqual(len(neural.validate_bundle(bundle, data, learning.PIPELINE)), 12)
        self.assertEqual(bundle["pipeline"]["execution_attestation"], "NOT_ESTABLISHED")

    def test_cli_prepares_contiguous_package_and_preserves_mode_when_training(self):
        data = learning.build_dataset(self.archives, stitch=True)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            arguments = []
            for index, archive in enumerate(self.archives):
                path = root / f"raw_{index}.json"
                ev.write(path, archive)
                arguments.extend(["--archive", str(path)])
            ev.write(root / "plan.json", contiguous_plan(data))
            for args in (
                ["prepare", *arguments, "--stitch-contiguous", "--output", str(root / "prepared")],
                ["train", "--source", str(root / "prepared"), "--plan", str(root / "plan.json"), "--output", str(root / "fit")],
                ["verify", "--directory", str(root / "fit")]):
                result = subprocess.run([sys.executable, "-bb", "-X", "dev", "-W", "error",
                                         str(ROOT / "scripts/train_trade_readout.py"), *args],
                                        capture_output=True, text=True, timeout=60)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(json.loads(result.stdout)["classification"], "SYNTHETIC_FIXTURE")


class SessionTests(unittest.TestCase):
    """Mocked acquisition behavior only; hosted captures establish actual RPC execution."""

    def setUp(self):
        self.sources = split_archives()[:2]
        self.calls = []
        self.fail_slot = None
        self.empty_slots = set()
        self.bad_parent = False

    def transport(self, request, endpoint, limit):
        self.calls.append(deepcopy(request))
        method, params = request["method"], request["params"]
        if method == "getSlot":
            result = 1001
        elif method == "getGenesisHash":
            result = ev.MAINNET_GENESIS
        elif method == "getBlocks":
            result = [] if params[0] in self.empty_slots else [params[0]]
        else:
            self.assertEqual(method, "getBlock")
            if params[0] == self.fail_slot:
                return 429, b"fixture rate limit", "HTTP_429"
            source = self.sources[params[0] - 1000]
            result = deepcopy(ev.parse(ev.unbase64(source["records"][3]["response_base64"]))["result"])
            if self.bad_parent and params[0] == 1001:
                result["previousBlockhash"] = fixture.address("wrong")
        raw = ev.canonical({"jsonrpc": "2.0", "id": 1, "result": result}).encode()
        return 200, raw, None

    def collect(self, root):
        return history.collect(root, slot_count=2, start_slot=1000, transport=self.transport)

    def test_complete_session_has_fixed_coverage_raw_lineage_and_no_training(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "history"
            result = self.collect(root)
            archives, manifest = history.verify(root)
            self.assertEqual(result["archive_count"], 2)
            self.assertEqual(result["produced_block_count"], 2)
            self.assertEqual(result["transaction_count"], 128)
            self.assertEqual(result["trade_count"], 132)
            self.assertFalse(result["training_performed"])
            self.assertFalse(result["live_execution_allowed"])
            self.assertEqual(result["source_attestation"], "SINGLE_RPC_ASSERTION_NOT_INDEPENDENT")
            self.assertEqual(len(archives), 2)
            self.assertEqual(manifest["blocks"][1]["parent_slot"], manifest["blocks"][0]["slot"])
            self.assertEqual({r["method"] for r in self.calls},
                             {"getGenesisHash", "getSlot", "getBlocks", "getBlock"})

    def test_failed_attempt_is_retained_and_resume_fetches_only_unfinished_slots(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "history"
            self.fail_slot = 1001
            with self.assertRaisesRegex(ev.EvidenceError, "CAPTURE_INCOMPLETE"):
                self.collect(root)
            first = root / "segment_000/attempt_000/archive.json"
            failed = root / "segment_001/attempt_000/archive.json"
            before, retained = first.read_bytes(), failed.read_bytes()
            self.fail_slot, self.calls = None, []
            result = history.resume(root, transport=self.transport)
            self.assertEqual(first.read_bytes(), before)
            self.assertEqual(failed.read_bytes(), retained)
            self.assertEqual([r["params"][0] for r in self.calls if r["method"] == "getBlock"], [1001])
            self.assertEqual(result["status"], "COMPLETE")
            _, manifest = history.verify(root)
            self.assertEqual(manifest["segments"][1]["selected_attempt"], 1)
            self.assertEqual(manifest["segments"][1]["attempts"][0]["status"], "INCOMPLETE")

    def test_finished_resume_makes_no_rpc_requests_and_fresh_collection_cannot_overwrite(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "history"
            self.collect(root)
            self.calls = []
            history.resume(root, transport=self.transport)
            self.assertEqual(self.calls, [])
            with self.assertRaises(FileExistsError):
                self.collect(root)

    def test_partial_session_is_not_accepted_as_a_verified_source_package(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "history"
            self.fail_slot = 1001
            with self.assertRaises(ValueError):
                self.collect(root)
            with self.assertRaisesRegex(ev.EvidenceError, "SESSION_INCOMPLETE"):
                history.verify(root)
            self.assertFalse((root / "session-manifest.json").exists())

    def test_interrupted_empty_attempt_directory_is_preserved_and_retried(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "history"
            self.fail_slot = 1000
            with self.assertRaises(ValueError):
                self.collect(root)
            archive = root / "segment_000/attempt_000/archive.json"
            archive.unlink()  # Represents termination before the capture wrote a retained archive.
            self.fail_slot = None
            history.resume(root, transport=self.transport)
            _, manifest = history.verify(root)
            self.assertEqual(manifest["segments"][0]["attempts"][0]["status"], "INTERRUPTED")
            self.assertFalse(archive.exists())

    def test_attempt_budget_exhaustion_preserves_all_failed_evidence(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "history"
            self.fail_slot = 1000
            for attempt in range(history.MAX_ATTEMPTS):
                with self.assertRaisesRegex(ev.EvidenceError, "CAPTURE_INCOMPLETE"):
                    self.collect(root) if attempt == 0 else history.resume(root, transport=self.transport)
            self.calls = []
            with self.assertRaisesRegex(ev.EvidenceError, "SESSION_ATTEMPTS_EXHAUSTED"):
                history.resume(root, transport=self.transport)
            self.assertEqual(self.calls, [])

    def test_cross_segment_link_failure_prevents_complete_manifest(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "history"
            self.bad_parent = True
            with self.assertRaisesRegex(ev.EvidenceError, "HISTORY_BLOCK_LINKAGE_GAP"):
                self.collect(root)
            self.assertFalse((root / "session-manifest.json").exists())
            with self.assertRaisesRegex(ev.EvidenceError, "HISTORY_BLOCK_LINKAGE_GAP"):
                history.resume(root, transport=self.transport)

    def test_explicit_skipped_slot_is_distinct_from_failed_capture(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "history"
            self.empty_slots = {1001}
            result = self.collect(root)
            self.assertEqual(result["skipped_slots"], [1001])
            self.assertEqual(result["produced_block_count"], 1)
            self.assertEqual(history.verify(root)[1]["status"], "COMPLETE")

    def test_changed_manifest_or_request_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "history"
            self.collect(root)
            path = root / "session-manifest.json"
            manifest = ev.read(path)
            manifest["trade_count"] += 1
            path.write_text(ev.canonical(manifest), encoding="utf-8")
            with self.assertRaisesRegex(ev.EvidenceError, "SESSION_MANIFEST_RECONSTRUCTION_MISMATCH"):
                history.verify(root)

    def test_changed_retained_raw_response_is_rejected_before_resume_transport(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "history"
            self.fail_slot = 1001
            with self.assertRaises(ValueError):
                self.collect(root)
            path = root / "segment_000/attempt_000/archive.json"
            archive = ev.read(path)
            archive["records"][3]["response_sha256"] = "a" * 64
            path.write_text(ev.canonical(archive), encoding="utf-8")
            self.calls = []
            with self.assertRaises(ValueError):
                history.resume(root, transport=self.transport)
            self.assertEqual(self.calls, [])

    def test_invalid_capture_settings_are_rejected_before_rpc_or_directory_creation(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "history"
            for settings in ({"slot_count": 0}, {"slot_count": True}, {"slot_count": 65},
                             {"start_slot": -1}, {"endpoint": "https://example.com"}):
                with self.assertRaises(ValueError):
                    history.collect(root, transport=self.transport, **settings)
            self.assertEqual(self.calls, [])
            self.assertFalse(root.exists())

    def test_anchor_failure_is_retained_and_cannot_be_resumed_with_an_unfixed_range(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "history"
            with self.assertRaises(ValueError):
                history.collect(root, transport=lambda *_: (429, b"fixture rate limit", "HTTP_429"))
            self.assertTrue((root / "anchor.json").is_file())
            self.assertFalse((root / "request.json").exists())
            with self.assertRaises(ValueError):
                history.resume(root, transport=self.transport)

    def test_storage_budget_stops_before_another_segment_is_requested(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "history"
            with patch.object(history, "MAX_STORED_BYTES", 1024 * 1024):
                with self.assertRaisesRegex(ev.EvidenceError, "SESSION_STORAGE_BOUND"):
                    self.collect(root)
            self.assertEqual([r["method"] for r in self.calls], ["getSlot"])

    def test_concurrent_writer_is_rejected_without_fetching(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "history"
            self.collect(root)
            self.calls = []
            with history._writer(root):
                with self.assertRaisesRegex(ev.EvidenceError, "SESSION_WRITER_BUSY"):
                    history.resume(root, transport=self.transport)
            self.assertEqual(self.calls, [])

    def test_unknown_paths_and_out_of_range_segment_cannot_be_accepted(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "history"
            self.collect(root)
            (root / "segment_002").mkdir()
            with self.assertRaisesRegex(ev.EvidenceError, "SESSION_SEGMENT_OUT_OF_RANGE"):
                history.verify(root)
            (root / "segment_002").rmdir()
            (root / "unknown.json").write_text("{}", encoding="utf-8")
            with self.assertRaisesRegex(ev.EvidenceError, "SESSION_LAYOUT"):
                history.verify(root)

    def test_source_session_cli_verifies_and_prepares_without_reaching_rpc(self):
        with tempfile.TemporaryDirectory() as folder:
            root, prepared = Path(folder) / "history", Path(folder) / "prepared"
            self.collect(root)
            for args in (["verify", "--directory", str(root)],
                         ["prepare", "--directory", str(root), "--output", str(prepared)]):
                result = subprocess.run([sys.executable, "-bb", "-X", "dev", "-W", "error",
                                         str(ROOT / "scripts/collect_trade_history.py"), *args],
                                        capture_output=True, text=True, timeout=60)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertFalse(json.loads(result.stdout)["training_performed"])
            _, data = learning.load_sources(prepared)
            self.assertEqual(data["protocol"], learning.CONTIGUOUS_DATASET)
            self.assertEqual(learning.assessment(data)["cross_archive_next_transaction_pairs"], 4)


if __name__ == "__main__":
    unittest.main()
