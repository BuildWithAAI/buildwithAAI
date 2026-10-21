"""Structural handoff and retained-source tests; fake vectors are never native evidence."""
import base64
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest

from src.ecosystem_research import handoff, mint_capture
from src.multi_brain_research import trade_fixture as fixture
from src.multi_brain_research import trade_learning as trade
from src.multi_brain_research import training_lab as lab
from src.multi_brain_research import neural_features as neural
from src.solana_research import coin_evidence as ev


class HandoffTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.archives, cls.data, cls.plan = fixture.demo()
        cls.raw_model, _ = trade.fit(cls.data, cls.plan)
        cls.bundle = neural.export(cls.data, trade.PIPELINE, trade.features,
                                   lambda rows: [[float(row[3])] * 57 for row in rows])
        cls.neural_model, _ = trade.fit(cls.data, cls.plan, cls.bundle)

    def test_forecasts_use_all_observations_including_final_unlabeled_rows(self):
        result = handoff.forecasts(self.data, self.raw_model, self.plan)
        self.assertEqual(len(result["rows"]), 384)
        self.assertEqual(sum(r["sequence"] == 31 for r in result["rows"]), 12)
        self.assertFalse(result["training_on_target_performed"])
        self.assertTrue(all(r["action"] == "NO_EXECUTION" and "label" not in r for r in result["rows"]))

    def test_target_dataset_can_differ_from_training_without_refitting(self):
        data = trade.build_dataset([self.archives[2]])
        before = deepcopy(self.raw_model)
        result = handoff.forecasts(data, before, self.plan)
        self.assertEqual(result["training_dataset_sha256"], lab.digest(self.data))
        self.assertEqual(result["dataset_sha256"], lab.digest(data))
        self.assertEqual(self.raw_model, before)
        self.assertEqual(len(result["rows"]), 128)

    def test_neural_target_export_is_validated_separately_from_training_export(self):
        data = trade.build_dataset([self.archives[2]])
        bundle = neural.export(data, trade.PIPELINE, trade.features,
                               lambda rows: [[float(row[3])] * 57 for row in rows])
        result = handoff.forecasts(data, self.neural_model, self.plan, bundle)
        self.assertNotEqual(result["feature_export_sha256"], self.neural_model["feature_export_sha256"])
        self.assertEqual(result["feature_execution_attestation"], "NOT_ESTABLISHED")

    def test_incompatible_feature_exports_never_fall_back_to_raw(self):
        for model, bundle in ((self.neural_model, None), (self.raw_model, self.bundle)):
            with self.assertRaises(ValueError):
                handoff.forecasts(self.data, model, self.plan, bundle)

    def test_changed_target_features_or_pipeline_are_rejected(self):
        for kind in ("dataset", "pipeline"):
            bundle = deepcopy(self.bundle)
            if kind == "dataset":
                bundle["dataset_sha256"] = "a" * 64
            else:
                bundle["pipeline"]["activity_units"] = "UNREGISTERED"
            with self.assertRaises(ValueError):
                handoff.forecasts(self.data, self.neural_model, self.plan, bundle)

    def test_changed_training_plan_or_execution_scope_is_rejected(self):
        model = deepcopy(self.raw_model)
        model["live_execution_allowed"] = True
        with self.assertRaises(ValueError):
            handoff.forecasts(self.data, model, self.plan)
        plan = {**self.plan, "horizon_transactions": 2}
        with self.assertRaises(ValueError):
            handoff.forecasts(self.data, self.raw_model, plan)

    def test_future_target_suffix_cannot_change_forecast_prefix(self):
        first = handoff.forecasts(self.data, self.raw_model, self.plan)
        changed = deepcopy(self.data)
        for episode in changed["episodes"]:
            for row in episode["observations"][20:]:
                row["last_price"]["numerator"] *= 2
        second = handoff.forecasts(changed, self.raw_model, self.plan)
        self.assertEqual([r for r in first["rows"] if r["sequence"] < 20],
                         [r for r in second["rows"] if r["sequence"] < 20])

    def test_transaction_horizons_are_never_relabeled_milliseconds(self):
        forecast = handoff.forecasts(self.data, self.neural_model, self.plan, self.bundle)
        decision = handoff.gate(forecast, self.neural_model)
        self.assertEqual(forecast["task"]["horizon_unit"], "LATER_MARKET_TRANSACTIONS")
        self.assertEqual(decision["research_signal"], "ABSTAIN")
        self.assertEqual(decision["qualified_model_count"], 0)
        self.assertIn("calibration", decision["missing_pipeline_components"])
        self.assertIn("COORDINATOR_HORIZON_ADAPTER_REQUIRED", decision["reasons"])
        self.assertFalse(decision["live_execution_allowed"])

    def test_registry_binds_encoder_recipe_separately_from_the_whole_pipeline(self):
        from src.multi_brain_research.consensus import ModuleSpec
        pipeline = neural.expected_pipeline(trade.PIPELINE)
        forecast = handoff.forecasts(self.data, self.neural_model, self.plan, self.bundle)
        decision = handoff.gate(forecast, self.neural_model)
        spec = ModuleSpec("trade_readout", "aai_trade_research", pipeline["connectome_sha256"],
                          pipeline["checkpoint_sha256"], lab.digest(pipeline["encoder"]),
                          lab.digest(self.neural_model), None)
        self.assertEqual(decision["registered_pipeline_sha256"], spec.pipeline_sha256())

    def test_registry_rejects_changed_model_or_forecast_pipeline_bindings(self):
        original = handoff.forecasts(self.data, self.neural_model, self.plan, self.bundle)
        for kind in ("model", "forecast"):
            model, forecast = deepcopy(self.neural_model), deepcopy(original)
            if kind == "model":
                model["pipeline_sha256"] = "a" * 64
                forecast["model_sha256"] = lab.digest(model)
            else:
                forecast["pipeline_sha256"] = "a" * 64
            with self.assertRaises(ValueError):
                handoff.gate(forecast, model)

    def test_forecast_from_another_model_cannot_reuse_the_gate(self):
        forecast = handoff.forecasts(self.data, self.raw_model, self.plan)
        forecast["model_sha256"] = "a" * 64
        with self.assertRaises(ValueError):
            handoff.gate(forecast, self.raw_model)

    def test_public_handoff_redacts_chain_identity_private_features_and_tokens(self):
        source = handoff.source_projection(self.data)
        forecast = handoff.forecasts(self.data, self.neural_model, self.plan, self.bundle)
        decision = handoff.gate(forecast, self.neural_model)
        snapshot = handoff.public_snapshot(source, forecast, decision, [],
                                           {"source_auditor": "SUCCEEDED", "forecast_reviewer": "SUCCEEDED"})
        serialized = ev.canonical(snapshot)
        for private in ("episode_id", "prediction_ppm", "features", "signature", "wallet", "credential"):
            self.assertNotIn(private, serialized)
        for episode in self.data["episodes"]:
            self.assertNotIn(episode["base_mint"], serialized)
            self.assertNotIn(episode["episode_id"], serialized)
        self.assertFalse(snapshot["payments_performed"])

    def test_incomplete_jobs_or_changed_source_cannot_appear_successful(self):
        source = handoff.source_projection(self.data)
        forecast = handoff.forecasts(self.data, self.raw_model, self.plan)
        decision = handoff.gate(forecast, self.raw_model)
        with self.assertRaises(ValueError):
            handoff.public_snapshot(source, forecast, decision, [],
                                    {"source_auditor": "SUCCEEDED", "forecast_reviewer": "RUNNING"})
        with self.assertRaises(ValueError):
            handoff.public_snapshot({**source, "dataset_sha256": "a" * 64}, forecast, decision, [],
                                    {"source_auditor": "SUCCEEDED", "forecast_reviewer": "SUCCEEDED"})

    def test_activity_events_are_hash_linked_and_never_orders(self):
        source = handoff.source_projection(self.data)
        forecast = handoff.forecasts(self.data, self.raw_model, self.plan)
        snapshot = handoff.public_snapshot(source, forecast, handoff.gate(forecast, self.raw_model), [],
                                           {"source_auditor": "SUCCEEDED", "forecast_reviewer": "SUCCEEDED"})
        events = handoff.public_events(snapshot)
        previous = "0" * 64
        for sequence, item in enumerate(events["events"]):
            self.assertEqual(item["sequence"], sequence)
            self.assertEqual(item["previous_sha256"], previous)
            payload = {k: v for k, v in item.items() if k != "sha256"}
            self.assertEqual(item["sha256"], lab.digest(payload))
            previous = item["sha256"]
        self.assertEqual(events["head_sha256"], previous)

    def test_scanner_decimal_conflict_is_rejected_and_authority_absence_is_not_safety(self):
        mint = next(iter(handoff.assets(self.data)))
        parsed = {"mint": mint, "status": "AVAILABLE", "decimals": 6, "evidence": {},
                  "mint_authority": None, "freeze_authority": None, "supply_raw": "1000"}
        result = handoff.inspection_projection(mint, parsed, 6)
        self.assertFalse(result["safety_established"])
        self.assertFalse(result["historical_risk_verified"])
        with self.assertRaises(ValueError):
            handoff.inspection_projection(mint, parsed, 7)

    def test_component_lock_requires_exact_repository_and_known_package_paths(self):
        lock = ev.read(handoff.LOCK_PATH)
        self.assertEqual(handoff.validate_lock(lock), lock)
        for field, value in (("repository", "unrelated/repo"), ("mode", "LIVE")):
            with self.assertRaises(ValueError):
                handoff.validate_lock({**lock, field: value})
        lock["components"]["scanner"]["package"] = "../unexpected"
        with self.assertRaises(ValueError):
            handoff.validate_lock(lock)


class MintCaptureTests(unittest.TestCase):
    def setUp(self):
        self.archives = fixture.archives()[:1]
        self.archives[0]["classification"] = "RPC_CAPTURE"  # Mocked bytes remain unit fixtures.
        self.data = trade.build_dataset(self.archives)
        self.calls = []
        self.fail = None

    def transport(self, request, endpoint, limit):
        self.calls.append(deepcopy(request))
        if self.fail:
            return 429, b"fixture rate limited", "HTTP_429"
        if request["method"] == "getGenesisHash":
            result = ev.MAINNET_GENESIS
        else:
            self.assertEqual(request["method"], "getAccountInfo")
            result = {"context": {"slot": 1005}, "value": None}
        return 200, ev.canonical({"jsonrpc": "2.0", "id": 1, "result": result}).encode(), None

    def collect(self, output):
        return mint_capture.collect(output, self.data, transport=self.transport)

    def test_only_read_methods_and_all_source_mints_are_captured_with_lower_slot_bound(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "capture"
            result = self.collect(root)
            self.assertEqual(len(result), 4)
            self.assertEqual(self.calls[0]["method"], "getGenesisHash")
            for request in self.calls[1:]:
                self.assertEqual(request["method"], "getAccountInfo")
                self.assertEqual(request["params"][1]["minContextSlot"], 1001)
            self.assertEqual(len(mint_capture.read(root, self.data)), 4)

    def test_failed_source_is_retained_and_never_an_accepted_empty_mint(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "capture"
            self.fail = True
            with self.assertRaises(ValueError):
                self.collect(root)
            record = ev.read(root / "network.json")["record"]
            self.assertEqual(record["http_status"], 429)
            with self.assertRaises(ValueError):
                mint_capture.read(root, self.data)

    def test_response_tampering_and_non_read_requests_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "capture"
            self.collect(root)
            path = root / "mint_000.json"
            original = ev.read(path)
            for field in ("hash", "method", "boolean_id"):
                item = deepcopy(original)
                if field == "hash":
                    item["record"]["response_sha256"] = "a" * 64
                elif field == "method":
                    item["record"]["request"]["method"] = "sendTransaction"
                    item["record"]["request_sha256"] = ev.digest(item["record"]["request"])
                else:
                    item["record"]["request"]["id"] = True
                path.write_text(ev.canonical(item), encoding="utf-8")
                with self.assertRaises(ValueError):
                    mint_capture.read(root, self.data)

    def test_older_context_and_changed_dataset_cannot_be_reused(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "capture"
            self.collect(root)
            path = root / "mint_000.json"
            item = ev.read(path)
            payload = ev.parse(ev.unbase64(item["record"]["response_base64"]))
            payload["result"]["context"]["slot"] = 999
            raw = ev.canonical(payload).encode()
            item["record"]["response_base64"], item["record"]["response_sha256"] = base64.b64encode(raw).decode(), ev.sha(raw)
            path.write_text(ev.canonical(item), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "MINT_CONTEXT_TOO_OLD"):
                mint_capture.read(root, self.data)

    def test_capture_directory_is_exclusive_and_unknown_files_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "capture"
            self.collect(root)
            with self.assertRaises(FileExistsError):
                self.collect(root)
            (root / "extra.json").write_text("{}", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "MINT_CAPTURE_LAYOUT"):
                mint_capture.read(root, self.data)

    def test_synthetic_source_and_unknown_endpoint_are_rejected_before_network(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "capture"
            with self.assertRaises(ValueError):
                mint_capture.collect(root, self.data, endpoint="https://example.com", transport=self.transport)
            data = deepcopy(self.data)
            data["classification"] = "SYNTHETIC_FIXTURE"
            with self.assertRaises(ValueError):
                mint_capture.collect(root, data, transport=self.transport)
            self.assertEqual(self.calls, [])

    def test_oversized_response_is_retained_incomplete(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "capture"
            with self.assertRaises(ValueError):
                mint_capture.collect(root, self.data, transport=lambda _r, _e, limit: (200, b"x" * (limit + 1), None))
            item = ev.read(root / "network.json")
            self.assertEqual(item["record"]["error"], "MINT_RESPONSE_BOUND")


class CaptureRecoveryTests(unittest.TestCase):
    def setUp(self):
        from scripts.capture_research_history import run
        self.run_capture = run
        self.archive = fixture.archives()[0]
        self.calls = []
        self.failure = "transient"
        self.failed = False

    def transport(self, request, _endpoint, _limit):
        method, params = request["method"], request["params"]
        self.calls.append(deepcopy(request))
        if self.failure == "anchor" and len(self.calls) == 1:
            return 429, b"fixture anchor limit", "HTTP_429"
        if self.failure == "transient" and method == "getBlock" and not self.failed:
            self.failed = True
            return 429, b"fixture rate limit", "HTTP_429"
        if method == "getGenesisHash":
            result = ev.MAINNET_GENESIS
        elif method == "getSlot":
            result = 1001
        elif method == "getBlocks":
            result = [params[0]]
        else:
            offset = params[0] - 1000
            result = ev.parse(ev.unbase64(self.archive["records"][3 + offset]["response_base64"]))["result"]
            if self.failure == "semantic" and params[0] == 1001:
                result["previousBlockhash"] = fixture.address("wrong")
        return 200, ev.canonical({"jsonrpc": "2.0", "id": 1, "result": result}).encode(), None

    def test_transient_recovery_retains_original_attempt_and_slot_range(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "source"
            result = self.run_capture(output, slot_count=2, start_slot=1000, transport=self.transport)
            self.assertEqual((result["start_slot"], result["end_slot"]), (1000, 1001))
            receipt = ev.read(output.with_name("source-recovery.json"))
            self.assertEqual(receipt["status"], "RECOVERED")
            self.assertEqual(receipt["retry_count"], 1)
            self.assertEqual(receipt["failure"]["http_status"], 429)
            self.assertTrue((output / "segment_000/attempt_000/archive.json").is_file())
            self.assertTrue((output / "segment_000/attempt_001/archive.json").is_file())
            self.assertEqual([r["params"][0] for r in self.calls if r["method"] == "getBlock"],
                             [1000, 1000, 1001])

    def test_semantic_link_failure_is_not_retried(self):
        with tempfile.TemporaryDirectory() as folder:
            self.failure = "semantic"
            output = Path(folder) / "source"
            with self.assertRaisesRegex(ValueError, "HISTORY_BLOCK_LINKAGE_GAP"):
                self.run_capture(output, slot_count=2, start_slot=1000, transport=self.transport)
            receipt = ev.read(output.with_name("source-recovery.json"))
            self.assertFalse(receipt["retry_requested"])
            self.assertEqual(receipt["status"], "NOT_RETRIED")
            self.assertEqual(len([r for r in self.calls if r["method"] == "getBlock"]), 2)

    def test_missing_finalized_anchor_cannot_trigger_a_different_range(self):
        with tempfile.TemporaryDirectory() as folder:
            self.failure = "anchor"
            output = Path(folder) / "source"
            with self.assertRaises(ValueError):
                self.run_capture(output, slot_count=2, transport=self.transport)
            receipt = ev.read(output.with_name("source-recovery.json"))
            self.assertFalse(receipt["fixed_range_present"])
            self.assertEqual(len(self.calls), 1)

    def test_existing_capture_is_never_overwritten_or_recovered_implicitly(self):
        with tempfile.TemporaryDirectory() as folder:
            self.failure = None
            output = Path(folder) / "source"
            self.run_capture(output, slot_count=2, start_slot=1000, transport=self.transport)
            self.calls = []
            with self.assertRaises(FileExistsError):
                self.run_capture(output, slot_count=2, start_slot=1000, transport=self.transport)
            self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
