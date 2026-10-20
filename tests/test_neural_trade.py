"""Neural-export contract tests use fake vectors; actual CPU inference is a separate CI job."""
from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from src.multi_brain_research import neural_features as neural
from src.multi_brain_research import trade_fixture as fixture
from src.multi_brain_research import trade_learning as trade
from src.multi_brain_research import training_lab as lab
from src.solana_research import coin_evidence as ev

ROOT = Path(__file__).resolve().parents[1]


def fake_activity(rows):
    # A schema/fitting test double; never evidence that FlyVis executed.
    return [[row[j % 5] * (1 + j % 3) / 3 for j in range(57)] for row in rows]


class NeuralTradeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.archives, cls.data, cls.plan = fixture.demo()
        cls.bundle = neural.export(cls.data, trade.PIPELINE, trade.features, fake_activity)

    def setUp(self):
        self.export = deepcopy(self.bundle)

    def test_expected_core_encoder_and_non_input_cell_contract(self):
        pipeline = neural.expected_pipeline(trade.PIPELINE)
        self.assertEqual(len(pipeline["readout_cell_types"]), 57)
        self.assertFalse(set(pipeline["readout_cell_types"]) & {f"R{i}" for i in range(1, 9)})
        self.assertEqual(pipeline["core_state_sha256"], neural.CORE_STATE_SHA256)
        self.assertFalse(pipeline["encoder"]["raw_features_appended"])
        self.assertEqual(pipeline["execution_attestation"], "NOT_ESTABLISHED")
        neural.validate_bundle(self.export, self.data, trade.PIPELINE)

    def test_export_dataset_and_classification_cannot_be_rebound_silently(self):
        for field, value in (("dataset_sha256", "a" * 64), ("classification", "RPC_CAPTURE")):
            export = deepcopy(self.bundle)
            export[field] = value
            with self.assertRaisesRegex(lab.TrainingError, "NEURAL_DATASET_BINDING"):
                neural.validate_bundle(export, self.data, trade.PIPELINE)

    def test_core_checkpoint_encoder_and_attestation_changes_are_rejected(self):
        changes = {"core_state_sha256": "a"*64, "checkpoint_sha256": "b"*64,
                   "upstream_commit": "c"*40, "execution_attestation": "SIGNED_AND_TRUSTED"}
        for field, value in changes.items():
            export = deepcopy(self.bundle)
            export["pipeline"][field] = value
            with self.assertRaisesRegex(lab.TrainingError, "NEURAL_PIPELINE_BINDING"):
                neural.validate_bundle(export, self.data, trade.PIPELINE)
        self.export["pipeline"]["encoder"]["visual_encoder"]["dt"] = 0.01
        with self.assertRaisesRegex(lab.TrainingError, "NEURAL_PIPELINE_BINDING"):
            neural.validate_bundle(self.export, self.data, trade.PIPELINE)

    def test_reordered_cells_or_added_raw_columns_are_rejected(self):
        self.export["pipeline"]["readout_cell_types"].reverse()
        with self.assertRaisesRegex(lab.TrainingError, "NEURAL_PIPELINE_BINDING"):
            neural.validate_bundle(self.export, self.data, trade.PIPELINE)
        self.export = deepcopy(self.bundle)
        key = self.data["episodes"][0]["episode_id"]
        self.export["features"][key][0].extend([0.0]*5)
        with self.assertRaisesRegex(lab.TrainingError, "NEURAL_OUTPUT_WIDTH"):
            neural.validate_bundle(self.export, self.data, trade.PIPELINE)

    def test_missing_episode_or_row_cannot_shift_feature_alignment(self):
        key = self.data["episodes"][0]["episode_id"]
        self.export["features"].pop(key)
        with self.assertRaisesRegex(lab.TrainingError, "NEURAL_EPISODE_BINDING"):
            neural.validate_bundle(self.export, self.data, trade.PIPELINE)
        self.export = deepcopy(self.bundle)
        self.export["features"][key].pop()
        with self.assertRaisesRegex(lab.TrainingError, "NEURAL_ROW_ALIGNMENT"):
            neural.validate_bundle(self.export, self.data, trade.PIPELINE)

    def test_nonfinite_and_boolean_activity_values_are_rejected(self):
        key = self.data["episodes"][0]["episode_id"]
        for value in (float("nan"), float("inf"), True):
            export = deepcopy(self.bundle)
            export["features"][key][0][0] = value
            with self.assertRaises(lab.TrainingError):
                neural.validate_bundle(export, self.data, trade.PIPELINE)

    def test_neural_episode_row_and_total_budgets_are_enforced(self):
        data = deepcopy(self.data)
        data["episodes"] = []
        with self.assertRaisesRegex(lab.TrainingError, "NEURAL_EPISODE_BOUND"):
            neural.check_bounds(data)
        data["episodes"] = deepcopy(self.data["episodes"])*6
        with self.assertRaisesRegex(lab.TrainingError, "NEURAL_EPISODE_BOUND"):
            neural.check_bounds(data)
        data["episodes"] = [deepcopy(self.data["episodes"][0])]
        data["episodes"][0]["observations"] *= 17
        with self.assertRaisesRegex(lab.TrainingError, "NEURAL_ROW_BOUND"):
            neural.check_bounds(data)
        data["episodes"] = [deepcopy(self.data["episodes"][0]) for _ in range(5)]
        for episode in data["episodes"]:
            episode["observations"] *= 16
        with self.assertRaisesRegex(lab.TrainingError, "NEURAL_TOTAL_ROW_BOUND"):
            neural.check_bounds(data)

    def test_input_encoder_requires_five_bounded_causal_features(self):
        for rows in ([], [[0.0]*4], [[0.0]*6], [[2.0]*5], [[float("nan")]*5], [[True]*5]):
            with self.assertRaises(lab.TrainingError):
                neural.check_input_rows(rows)

    def test_exporter_receives_each_episode_in_original_internal_order(self):
        received = []
        def recorder(rows):
            received.append(deepcopy(rows))
            return fake_activity(rows)
        neural.export(self.data, trade.PIPELINE, trade.features, recorder)
        self.assertEqual(len(received), len(self.data["episodes"]))
        for rows, episode in zip(received, self.data["episodes"], strict=True):
            self.assertEqual(rows, [trade.features(episode, i) for i in range(len(episode["observations"]))])

    def test_examples_consume_only_exported_activity_not_appended_raw_features(self):
        partitions = trade.examples(self.data, self.plan, self.export)
        for rows in partitions.values():
            for row in rows:
                self.assertEqual(len(row["x"]), 57)
                self.assertEqual(row["x"], self.export["features"][row["episode_id"]][row["index"]])
        self.assertEqual(len(trade.examples(self.data, self.plan)["train"][0]["x"]), 5)

    def test_neural_readout_fit_is_pinned_and_declares_execution_attestation_unestablished(self):
        model, report = trade.fit(self.data, self.plan, self.export)
        self.assertEqual(len(model["weights"]), 57)
        self.assertEqual(model["feature_export_sha256"], lab.digest(self.export))
        self.assertTrue(report["biological_core_used"])
        self.assertFalse(report["biological_core_weights_updated"])
        self.assertEqual(report["feature_execution_attestation"], "NOT_ESTABLISHED")
        self.assertFalse(report["neural_reexecution_performed_by_readout_verifier"])
        self.assertFalse(report["live_execution_allowed"])

    def test_heldout_neural_vectors_cannot_update_training_weights_or_normalizer(self):
        before, _ = trade.fit(self.data, self.plan, self.export)
        for part in ("validation", "test"):
            for key in self.plan["splits"][part]:
                for row in self.export["features"][key]:
                    row[:] = [-value for value in row]
        after, _ = trade.fit(self.data, self.plan, self.export)
        for field in ("weights", "bias", "means", "scales"):
            self.assertEqual(before[field], after[field])

    def test_training_vectors_actually_change_the_fitted_readout(self):
        before, _ = trade.fit(self.data, self.plan, self.export)
        for key in self.plan["splits"]["train"]:
            for row in self.export["features"][key]:
                row[:] = [0.0]*57
        after, _ = trade.fit(self.data, self.plan, self.export)
        self.assertNotEqual(before["weights"], after["weights"])

    def test_neural_public_trace_keeps_delayed_labels_and_final_predictions(self):
        model, _ = trade.fit(self.data, self.plan, self.export)
        trace = trade.public_trace(self.data, self.plan, model, self.export)
        predictions, observations = {}, 0
        for item in trace["events"]:
            event = item["event"]
            if event["type"] == "OBSERVATION":
                observations += 1
                self.assertEqual(len(event["features"]), 57)
            elif event["type"] == "PREDICTION":
                predictions[(event["episode_alias"], event["sequence"])] = True
                self.assertEqual(event["action"], "NO_EXECUTION")
                self.assertNotIn("label", event)
            else:
                self.assertIn((event["episode_alias"], event["decision_sequence"]), predictions)
                self.assertGreater(event["sequence"], event["decision_sequence"])
        self.assertEqual(len(predictions), observations)
        self.assertEqual(sum(sequence == 31 for _, sequence in predictions), 4)

    def test_neural_model_requires_its_exact_export_for_predictions(self):
        model, _ = trade.fit(self.data, self.plan, self.export)
        with self.assertRaisesRegex(lab.TrainingError, "NEURAL_EXPORT_REQUIRED"):
            trade.public_trace(self.data, self.plan, model)
        key = self.data["episodes"][0]["episode_id"]
        self.export["features"][key][0][0] += 0.01
        with self.assertRaisesRegex(lab.TrainingError, "NEURAL_MODEL_EXPORT_BINDING"):
            trade.public_trace(self.data, self.plan, model, self.export)

    def test_model_pipeline_cannot_be_changed_independently_of_export(self):
        model, _ = trade.fit(self.data, self.plan, self.export)
        model["pipeline_sha256"] = "a"*64
        with self.assertRaisesRegex(lab.TrainingError, "TRADE_PIPELINE_BINDING"):
            trade.public_trace(self.data, self.plan, model, self.export)

    def test_saved_neural_package_reconstructs_sources_and_refits_without_claiming_native_execution(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "trial"
            result = trade.run(self.archives, self.plan, output, self.export)
            checked = trade.verify(output)
            self.assertEqual(checked["model_sha256"], result["model_sha256"])
            self.assertTrue(checked["biological_core_used"])
            self.assertFalse(checked["neural_reexecution_performed"])
            self.assertEqual(checked["feature_execution_attestation"], "NOT_ESTABLISHED")
            self.assertTrue((output / "neural-features.json").is_file())

    def test_changed_feature_export_fails_retained_model_replay(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "trial"
            trade.run(self.archives, self.plan, output, self.export)
            key = self.data["episodes"][0]["episode_id"]
            self.export["features"][key][0][0] += 0.01
            (output / "neural-features.json").write_text(lab.canonical(self.export), encoding="utf-8")
            with self.assertRaisesRegex(lab.TrainingError, "TRADE_TRAINING_REPLAY_MISMATCH"):
                trade.verify(output)

    def test_deleted_export_cannot_silently_fall_back_to_raw_features(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "trial"
            trade.run(self.archives, self.plan, output, self.export)
            (output / "neural-features.json").unlink()
            with self.assertRaisesRegex(lab.TrainingError, "NEURAL_EXPORT_REQUIRED"):
                trade.verify(output)

    def test_raw_package_rejects_an_unexpected_neural_export(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "trial"
            trade.run(self.archives, self.plan, output)
            ev.write(output / "neural-features.json", self.export)
            with self.assertRaisesRegex(lab.TrainingError, "UNEXPECTED_NEURAL_EXPORT"):
                trade.verify(output)

    def test_cli_accepts_a_pinned_export_and_independently_refits_it(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            trade.prepare(self.archives, root / "source")
            ev.write(root / "plan.json", self.plan)
            ev.write(root / "features.json", self.export)
            commands = [["train", "--source", str(root / "source"), "--plan", str(root / "plan.json"),
                         "--features", str(root / "features.json"), "--output", str(root / "trained")],
                        ["verify", "--directory", str(root / "trained")]]
            for args in commands:
                process = subprocess.run([sys.executable, "-bb", "-X", "dev", "-W", "error",
                    str(ROOT / "scripts/train_trade_readout.py"), *args],
                    capture_output=True, text=True, timeout=60)
                self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
                result = json.loads(process.stdout)
                self.assertTrue(result["biological_core_used"])
                self.assertFalse(result["live_execution_allowed"])


if __name__ == "__main__":
    unittest.main()
