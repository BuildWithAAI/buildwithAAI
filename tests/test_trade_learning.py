"""AAI.fun leakage, source-lineage and actual readout-fitting regressions."""
from copy import deepcopy
import base64
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from src.multi_brain_research import trade_fixture as fixture
from src.multi_brain_research import trade_learning as learning
from src.multi_brain_research import training_lab as lab
from src.solana_research import coin_evidence as ev

ROOT = Path(__file__).resolve().parents[1]


def edit_payload(archive, index, change):
    record = archive["records"][index]
    payload = ev.parse(ev.unbase64(record["response_base64"]))
    change(payload)
    raw = ev.canonical(payload).encode()
    record["response_base64"], record["response_sha256"] = base64.b64encode(raw).decode(), ev.sha(raw)


class TradeLearningTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source, cls.dataset, cls.settings = fixture.demo()

    def setUp(self):
        self.archives = deepcopy(self.source)
        self.data, self.plan = deepcopy(self.dataset), deepcopy(self.settings)

    def repin(self):
        self.plan["dataset_sha256"] = lab.digest(self.data)

    def test_transaction_atomic_observations_do_not_split_inner_swaps(self):
        self.assertEqual(len(self.data["episodes"]), 12)
        self.assertEqual(sum(len(e["observations"]) for e in self.data["episodes"]), 384)
        self.assertEqual(sum(s["trade_count"] for s in self.data["sources"]), 396)
        self.assertTrue(all(e["observations"][7]["trade_count"] == 2 for e in self.data["episodes"]))
        self.assertEqual(self.data["classification"], "SYNTHETIC_FIXTURE")

    def test_observation_features_never_include_bid_ask_or_depth(self):
        for episode in self.data["episodes"]:
            visible = learning.observation(episode, 0, self.plan)
            self.assertEqual(set(visible), {"alias", "episode_alias", "sequence", "order", "features"})
            self.assertEqual(len(visible["features"]), 5)
            self.assertNotIn("bid", lab.canonical(visible))
            self.assertNotIn("depth", lab.canonical(visible))

    def test_source_response_tamper_is_rejected_before_dataset_build(self):
        self.archives[0]["records"][3]["response_sha256"] = "f" * 64
        with self.assertRaisesRegex(ev.EvidenceError, "RESPONSE_HASH_MISMATCH"):
            learning.build_dataset(self.archives)

    def test_overlapping_archive_windows_cannot_duplicate_observations(self):
        with self.assertRaisesRegex(lab.TrainingError, "OVERLAPPING_SOURCE_WINDOWS"):
            learning.build_dataset([self.archives[0], self.archives[0]])

    def test_mixed_synthetic_and_recorded_sources_are_rejected(self):
        self.archives[1]["classification"] = "RPC_CAPTURE"
        with self.assertRaisesRegex(lab.TrainingError, "MIXED_SYNTHETIC"):
            learning.build_dataset(self.archives)

    def test_duplicate_signature_across_disjoint_sources_is_rejected(self):
        signature = ev.parse(ev.unbase64(self.archives[0]["records"][3]["response_base64"]))[
            "result"]["transactions"][0]["transaction"]["signatures"][0]
        def change(payload):
            payload["result"]["transactions"][0]["transaction"]["signatures"][0] = signature
        edit_payload(self.archives[1], 3, change)
        with self.assertRaisesRegex(lab.TrainingError, "DUPLICATE_SOURCE_TRANSACTION"):
            learning.build_dataset(self.archives)

    def test_unknown_outcome_or_quote_fields_cannot_enter_observations(self):
        self.data["episodes"][0]["observations"][0]["future_rug"] = True
        with self.assertRaisesRegex(lab.TrainingError, "INVALID_FIELDS"):
            learning.validate_dataset(self.data)

    def test_coin_group_identity_is_derived_from_mint_not_alias(self):
        self.data["episodes"][0]["asset_group_sha256"] = "a" * 64
        with self.assertRaisesRegex(lab.TrainingError, "ASSET_GROUP_IDENTITY_MISMATCH"):
            learning.validate_dataset(self.data)

    def test_same_coin_cannot_cross_partitions_through_another_pool(self):
        train = self.data["episodes"][0]
        held = self.data["episodes"][4]
        held["base_mint"], held["asset_group_sha256"] = train["base_mint"], train["asset_group_sha256"]
        self.repin()
        with self.assertRaisesRegex(lab.TrainingError, "ASSET_GROUP_LEAKAGE"):
            learning.validate_plan(self.data, self.plan)

    def test_same_coin_may_have_multiple_markets_within_one_partition(self):
        first, second = self.data["episodes"][:2]
        second["base_mint"], second["asset_group_sha256"] = first["base_mint"], first["asset_group_sha256"]
        self.repin()
        learning.validate_plan(self.data, self.plan)

    def test_chronological_holdout_gap_is_required(self):
        self.plan["max_horizon_slots"] = 4096
        with self.assertRaisesRegex(lab.TrainingError, "TRADE_CHRONOLOGY_OR_HORIZON_GAP"):
            learning.validate_plan(self.data, self.plan)

    def test_every_episode_is_assigned_once_and_inputs_are_pinned(self):
        self.plan["splits"]["test"].pop()
        with self.assertRaisesRegex(lab.TrainingError, "UNASSIGNED_TRADE_EPISODE"):
            learning.validate_plan(self.data, self.plan)
        self.plan = deepcopy(self.settings)
        self.data["episodes"][0]["observations"][0]["base_volume_atoms"] += 1
        with self.assertRaisesRegex(lab.TrainingError, "TRADE_PLAN_DATASET_PIN"):
            learning.validate_plan(self.data, self.plan)

    def test_source_counts_and_integer_units_cannot_be_fabricated(self):
        self.data["sources"][0]["trade_count"] += 1
        with self.assertRaisesRegex(lab.TrainingError, "SOURCE_TRADE_COUNT_MISMATCH"):
            learning.validate_dataset(self.data)
        self.data = deepcopy(self.dataset)
        self.data["episodes"][0]["observations"][0]["quote_volume_atoms"] = True
        with self.assertRaises(ev.EvidenceError):
            learning.validate_dataset(self.data)

    def test_targets_are_later_transactions_and_no_missing_outcome_is_invented(self):
        episodes = {e["episode_id"]: e for e in self.data["episodes"]}
        rows = learning.examples(self.data, self.plan)
        for members in rows.values():
            self.assertEqual(len(members), 124)
            for row in members:
                observed = episodes[row["episode_id"]]["observations"]
                self.assertGreater(tuple(observed[row["target_index"]]["order"]), tuple(observed[row["index"]]["order"]))
                self.assertEqual(row["target_index"], row["index"] + 1)
                self.assertLess(row["index"], 31)

    def test_stale_targets_across_slot_gap_are_excluded(self):
        archive = self.archives[0]
        archive["requested_end_slot"] += 2
        edit_payload(archive, 1, lambda p: p.update(result=1003))
        edit_payload(archive, 2, lambda p: p.update(result=[1000, 1003]))
        for index in (2, 4):
            archive["records"][index]["request"]["params"][1 if index == 2 else 0] = 1003
            archive["records"][index]["request_sha256"] = ev.digest(archive["records"][index]["request"])
        self.data = learning.build_dataset(self.archives)
        self.plan = fixture.plan(self.data)
        self.plan["max_horizon_slots"] = 1
        rows = learning.examples(self.data, self.plan)["train"]
        self.assertEqual(len(rows), 120)
        self.assertNotIn(15, {r["index"] for r in rows})

    def test_future_price_and_volume_suffix_does_not_change_feature_prefix(self):
        episode = self.data["episodes"][0]
        before = [learning.observation(episode, i, self.plan) for i in range(8)]
        for row in episode["observations"][8:]:
            row["last_price"]["numerator"] *= 9
            row["quote_volume_atoms"] *= 5
        self.assertEqual(before, [learning.observation(episode, i, self.plan) for i in range(8)])

    def test_heldout_feature_and_label_changes_cannot_update_training_parameters(self):
        first, _ = learning.fit(self.data, self.plan)
        def change(payload):
            for transaction in payload["result"]["transactions"]:
                for group in transaction["meta"]["innerInstructions"]:
                    for instruction in group["instructions"]:
                        raw = bytearray(ev.b58decode(instruction["data"]))
                        raw[8:16] = ev.SELL if raw[8:16] == ev.BUY else ev.BUY
                        quote = int.from_bytes(raw[72:80], "little") * 3
                        raw[72:80] = quote.to_bytes(8, "little")
                        instruction["data"] = ev.b58encode(bytes(raw))
        for source in self.archives[1:]:
            for index in (3, 4):
                edit_payload(source, index, change)
        changed_data = learning.build_dataset(self.archives)
        changed_plan = fixture.plan(changed_data)
        self.assertNotEqual(learning.features(self.data["episodes"][4], 0),
                            learning.features(changed_data["episodes"][4], 0))
        second, _ = learning.fit(changed_data, changed_plan)
        for field in ("weights", "bias", "means", "scales"):
            self.assertEqual(first[field], second[field])

    def test_actual_readout_fitting_changes_weights_and_reduces_fixture_loss(self):
        model, report = learning.fit(self.data, self.plan)
        self.assertTrue(report["training_performed"])
        self.assertTrue(report["readout_parameters_changed"])
        self.assertTrue(any(abs(value) > 1e-6 for value in model["weights"]))
        self.assertLess(report["metrics"]["train"]["log_loss"], report["initial_train_metrics"]["log_loss"])
        self.assertFalse(report["biological_core_used"])
        self.assertEqual(report["profitability"], "NOT_EVALUATED")
        self.assertFalse(report["live_execution_allowed"])

    def test_fixed_inputs_have_reproducible_fitted_parameters_and_scores(self):
        self.assertEqual(learning.fit(self.data, self.plan), learning.fit(self.data, self.plan))

    def test_generic_fit_rejects_nonfinite_features_and_boolean_targets(self):
        for field, value in (("x", [float("nan")]*5), ("y", True)):
            rows = learning.examples(self.data, self.plan)
            rows["test"][0][field] = value
            with self.assertRaises(lab.TrainingError):
                lab.fit_parameters(rows, self.plan)

    def test_generic_fit_rejects_inconsistent_width_and_small_partitions(self):
        for invalid in ("width", "count"):
            rows = learning.examples(self.data, self.plan)
            if invalid == "width":
                rows["validation"][0]["x"].pop()
            else:
                rows["test"] = rows["test"][:3]
            with self.assertRaises(lab.TrainingError):
                lab.fit_parameters(rows, self.plan)

    def test_public_trace_predicts_even_when_future_outcome_is_missing(self):
        model, _ = learning.fit(self.data, self.plan)
        trace = learning.public_trace(self.data, self.plan, model)
        events = [item["event"] for item in trace["events"]]
        self.assertEqual(sum(e["type"] == "OBSERVATION" for e in events), 128)
        self.assertEqual(sum(e["type"] == "PREDICTION" for e in events), 128)
        self.assertEqual(sum(e["type"] == "OUTCOME" for e in events), 124)
        self.assertEqual(sum(e["type"] == "PREDICTION" and e["sequence"] == 31 for e in events), 4)

    def test_trace_outcomes_are_delayed_redacted_and_hash_linked(self):
        model, _ = learning.fit(self.data, self.plan)
        trace = learning.public_trace(self.data, self.plan, model)
        predictions, previous = set(), "0" * 64
        for item in trace["events"]:
            event = item["event"]
            self.assertEqual(item["previous_sha256"], previous)
            self.assertEqual(item["sha256"], lab.digest({"previous_sha256": previous, "event": event}))
            previous = item["sha256"]
            if event["type"] == "PREDICTION":
                predictions.add((event["episode_alias"], event["sequence"]))
                self.assertEqual(event["action"], "NO_EXECUTION")
                self.assertNotIn("label", event)
            if event["type"] == "OUTCOME":
                self.assertIn((event["episode_alias"], event["decision_sequence"]), predictions)
                self.assertGreater(event["sequence"], event["decision_sequence"])
        raw = lab.canonical(trace)
        episode = self.data["episodes"][8]
        for identity in (episode["episode_id"], episode["pool"], episode["base_mint"],
                         episode["quote_mint"], episode["observations"][0]["signature"]):
            self.assertNotIn(identity, raw)

    def test_changed_plan_cannot_reuse_a_model_for_public_predictions(self):
        model, _ = learning.fit(self.data, self.plan)
        self.plan["alias_salt"] = "a" * 64
        with self.assertRaisesRegex(lab.TrainingError, "TRADE_MODEL_INPUT_BINDING"):
            learning.public_trace(self.data, self.plan, model)

    def test_insufficient_source_cohort_is_reported_without_fitting(self):
        self.data = learning.build_dataset([self.archives[0]])
        status = learning.assessment(self.data)
        self.assertEqual(status["status"], "PLAN_REQUIRED")
        self.assertFalse(status["training_ready"])
        self.assertFalse(status["training_performed"])
        # A single complete source window cannot satisfy chronological held-out gaps.
        keys = [e["episode_id"] for e in self.data["episodes"]]
        self.plan["dataset_sha256"] = lab.digest(self.data)
        self.plan["splits"] = {"train": keys[:2], "validation": keys[2:3], "test": keys[3:]}
        with self.assertRaisesRegex(lab.TrainingError, "TRADE_CHRONOLOGY_OR_HORIZON_GAP"):
            learning.fit(self.data, self.plan)

    def test_empty_decoded_source_is_valid_evidence_and_insufficient_training_data(self):
        for index in (3, 4):
            edit_payload(self.archives[0], index, lambda p: p["result"].update(transactions=[]))
        data = learning.build_dataset([self.archives[0]])
        self.assertEqual(learning.assessment(data)["status"], "INSUFFICIENT_COHORT")
        self.assertEqual(data["episodes"], [])

    def test_prepared_dataset_must_reconstruct_from_raw_even_if_manifest_is_repinned(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "sources"
            learning.prepare(self.archives, output)
            data = ev.read(output / "dataset.json")
            data["episodes"][0]["observations"][0]["last_price"]["numerator"] *= 2
            manifest = ev.read(output / "source-manifest.json")
            manifest["dataset_sha256"] = lab.digest(data)
            (output / "dataset.json").write_text(ev.canonical(data), encoding="utf-8")
            (output / "source-manifest.json").write_text(ev.canonical(manifest), encoding="utf-8")
            with self.assertRaisesRegex(lab.TrainingError, "SOURCE_DATASET_RECONSTRUCTION_MISMATCH"):
                learning.load_sources(output)

    def test_manifest_cannot_reference_arbitrary_files(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "sources"
            learning.prepare(self.archives, output)
            manifest = ev.read(output / "source-manifest.json")
            manifest["archives"][0]["name"] = "../other.json"
            (output / "source-manifest.json").write_text(ev.canonical(manifest), encoding="utf-8")
            with self.assertRaisesRegex(lab.TrainingError, "ARCHIVE_FILENAME"):
                learning.load_sources(output)

    def test_run_retraining_verification_then_model_tamper_rejection(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "training"
            result = learning.run(self.archives, self.plan, output)
            self.assertEqual(learning.verify(output)["model_sha256"], result["model_sha256"])
            model = ev.read(output / "model.json")
            model["weights"][0] += 0.001
            (output / "model.json").write_text(ev.canonical(model), encoding="utf-8")
            with self.assertRaisesRegex(lab.TrainingError, "TRADE_TRAINING_REPLAY_MISMATCH"):
                learning.verify(output)

    def test_existing_source_or_training_package_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "training"
            learning.run(self.archives, self.plan, output)
            before = (output / "model.json").read_bytes()
            with self.assertRaises(FileExistsError):
                learning.run(self.archives, self.plan, output)
            self.assertEqual((output / "model.json").read_bytes(), before)

    def test_actual_cli_preparation_fitting_and_independent_verification(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            paths = []
            for index, archive in enumerate(self.archives):
                path = base / f"input_{index}.json"
                ev.write(path, archive)
                paths.extend(["--archive", str(path)])
            plan_path = base / "plan.json"
            ev.write(plan_path, self.plan)
            commands = [["prepare", *paths, "--output", str(base / "prepared")],
                        ["verify-sources", "--directory", str(base / "prepared")],
                        ["train", "--source", str(base / "prepared"), "--plan", str(plan_path),
                         "--output", str(base / "trained")],
                        ["verify", "--directory", str(base / "trained")]]
            for args in commands:
                process = subprocess.run([sys.executable, "-bb", "-X", "dev", "-W", "error",
                    str(ROOT / "scripts/train_trade_readout.py"), *args],
                    capture_output=True, text=True, timeout=60)
                self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
                result = json.loads(process.stdout)
                self.assertEqual(result["classification"], "SYNTHETIC_FIXTURE")
                self.assertFalse(result["live_execution_allowed"])


if __name__ == "__main__":
    unittest.main()
